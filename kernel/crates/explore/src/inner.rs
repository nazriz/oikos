//! The index's state and how a log line changes it (renderer/src/indexer.ts, `buildIndex`'s loop, one line at a time,
//! so a finished log and a live run's stream are read the same way). Everything the TS index keeps in files is held
//! here in memory: the kept lines (compressed frames), their postings, the actions, the records, the tracks.

use crate::consequential::{is_consequential_record, is_hard, memo_is_hard};
use crate::frames::FrameStore;
use crate::js::{g, gi, gs, jstr, jstr0, list, take_chars, truthy};
use crate::world::{accounts_of, class_code, class_of, class_of_code, person_of_participant, space_parts, world_of, WorldStatic};
use crate::{ActionRef, Decider};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

pub const DAY: i64 = 86_400;
pub const MOVE_INTS: usize = 3;
pub const PULSE_INTS: usize = 6;
pub const ACTION_INTS: usize = 4;

/// Events whose effect may be an act's: they follow the act's action_applied under the same cause. The rest are the world's.
const ACTED: [&str; 18] = [
    "transfer",
    "recorded",
    "message_delivered",
    "goods_moved",
    "account_opened",
    "entity_created",
    "appointed",
    "worked",
    "vacated",
    "condition_treated",
    "person_left",
    "position_created",
    "participant_created",
    "person_created",
    "person_arrived",
    "action_refused",
    "visited",
    "ask_answered",
];

/// One line, read once, before it touches the index (so this part can run on several threads).
pub enum Item {
    /// An empty or unreadable line (counted, nothing else).
    Blank,
    /// A line nobody watching needs (observe, look, advance, observations, debriefs...): only its time counts.
    Skip {
        t: i64,
    },
    Header {
        line: String,
        v: Value,
    },
    End {
        t: i64,
        reason: Option<String>,
        detail: Option<String>,
    },
    Line {
        line: String,
        kind: Kind,
        seq: i64,
        t: i64,
        v: Value,
    },
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Command,
    Annotation,
    Event,
    Other,
}

fn name_after<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let i = line.find(key)? + key.len();
    let rest = &line[i..];
    let n = rest.bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count();
    if n == 0 {
        None
    } else {
        Some(&rest[..n])
    }
}
fn int_after(tail: &str, key: &str) -> Option<i64> {
    let i = tail.find(key)? + key.len();
    let rest = &tail[i..];
    let n = rest.bytes().enumerate().take_while(|(k, c)| c.is_ascii_digit() || (*k == 0 && *c == b'-')).count();
    rest[..n].parse().ok()
}

/// Reads one raw log line (what the kernel wrote, canonical JSON) into an `Item`.
pub fn parse_line(line: &str) -> Item {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.is_empty() {
        return Item::Blank;
    }
    let cut = line.rfind("\"kind\":\"");
    let tail = cut.map(|c| &line[c..]).unwrap_or("");
    let kind = name_after(tail, "\"kind\":\"").unwrap_or("");
    let seq = int_after(tail, "\"seq\":").unwrap_or(-1);
    let t = int_after(tail, "\"t\":").unwrap_or(0);
    let bad = |_| Item::Blank;
    match kind {
        "header" => match serde_json::from_str::<Value>(line) {
            Ok(v) => Item::Header { line: line.to_string(), v },
            Err(e) => bad(e),
        },
        "end" => match serde_json::from_str::<Value>(line) {
            Ok(v) => {
                let b = v.get("body").cloned().unwrap_or(Value::Null);
                Item::End { t, reason: gs(&b, "reason").map(String::from), detail: gs(&b, "detail").map(String::from) }
            }
            Err(e) => bad(e),
        },
        "checkpoint" => Item::Blank,
        "command" => {
            let name = name_after(line, "\"command\":\"").unwrap_or("?");
            if name == "observe" || name == "look" || name.starts_with("advance") {
                return Item::Skip { t };
            }
            full(line, Kind::Command, seq, t)
        }
        "annotation" => {
            let name = name_after(line, "\"annotation\":\"").unwrap_or("?");
            if name == "debrief" || name == "observation" {
                return Item::Skip { t }; // (debriefs are never read here: VISION 15)
            }
            full(line, Kind::Annotation, seq, t)
        }
        "event" => {
            let name = name_after(line, "\"event\":\"").unwrap_or("?");
            if matches!(name, "observation" | "entity_recorded" | "ask_started" | "visit_started" | "birth_started") {
                return Item::Skip { t };
            }
            full(line, Kind::Event, seq, t)
        }
        _ => Item::Skip { t },
    }
}
fn full(line: &str, kind: Kind, seq: i64, t: i64) -> Item {
    match serde_json::from_str::<Value>(line) {
        Ok(v) => Item::Line { line: line.to_string(), kind, seq, t, v },
        Err(_) => Item::Blank,
    }
}

#[derive(Clone, Copy, Default, Debug)]
pub struct LineMeta {
    pub seq: i32,
    pub t: i32,
    pub action: i32,
    pub name: u32,
    /// Who decided (participant index; -1 the world).
    pub who: i32,
}

#[derive(Clone, Debug)]
pub struct Space {
    pub id: String,
    pub st: usize,
    pub kind: String,
    pub n: i64,
}

#[derive(Clone, Debug)]
pub struct Target {
    pub id: String,
    pub kind: &'static str,
    pub st: i64,
}
#[derive(Clone, Debug)]
pub struct SeatAct {
    pub ord: u32,
    pub seq: i64,
    pub t: i64,
    pub participant: String,
    pub as_: String,
    pub draft: Option<String>,
    pub via: Option<String>,
    pub action: i64,
    pub kinds: Vec<String>,
    pub text: String,
    pub from: i64,
    pub targets: Vec<Target>,
}

struct Snap {
    where_: Vec<u32>,
    money: Vec<i64>,
    agency: Vec<i16>,
    moves: usize,
}

/// The tracks as the client reads them, laid out by day (rebuilt when the index has grown).
pub struct Tracks {
    pub days: usize,
    pub persons: usize,
    pub holders: usize,
    pub where_: Vec<u32>,
    pub money: Vec<i64>,
    pub agency: Vec<i16>,
    pub moves_day: Vec<usize>,
    /// Holder index to its place in the money rows (persons first, in person order, then the organisations).
    pub holder_pos: Vec<usize>,
    pub holder_ids: Vec<String>,
}

#[derive(Default)]
pub struct Inner {
    pub have_header: bool,
    pub head_hash: String,
    pub world: Option<WorldStatic>,
    pub struct_idx: HashMap<String, usize>,
    pub extra_structures: Vec<String>,
    pub lines: u64,
    pub last_t: i64,
    pub end: Option<(Option<String>, Option<String>, i64)>,
    pub names: Vec<String>,
    name_code: HashMap<String, u32>,
    pub metas: Vec<LineMeta>,
    pub store: FrameStore,
    postings: HashMap<String, Vec<u32>>,
    known: HashSet<String>,
    // participants
    pub part_idx: HashMap<String, usize>,
    pub part_ids: Vec<String>,
    pub part_cls: Vec<Decider>,
    header_part: HashMap<String, Value>,
    pub seats: Vec<String>,
    seat_set: HashSet<String>,
    // people, holders, spaces
    pub person_idx: HashMap<String, usize>,
    pub persons: Vec<String>,
    pub holder_idx: HashMap<String, usize>,
    pub holders: Vec<String>,
    where_: Vec<u32>,
    home: Vec<i64>,
    last: Vec<i64>,
    money: Vec<i64>,
    agency: Vec<i16>,
    pub space_idx: HashMap<String, usize>,
    pub spaces: Vec<Space>,
    participant_person: HashMap<String, String>,
    /// Account to holder, in the order accounts were first seen.
    pub accounts: Vec<(String, String)>,
    acc_idx: HashMap<String, usize>,
    // tracks
    day: i64,
    snaps: Vec<Snap>,
    pub moves: Vec<i32>,
    pub pulses: Vec<i32>,
    // actions, records
    act_ord_by_seq: HashMap<i64, u32>,
    action_idx: HashMap<String, usize>,
    pub actions: Vec<[i32; ACTION_INTS]>,
    applied_by_cause: HashMap<i64, usize>,
    pub performers: HashMap<usize, String>,
    record_ord: HashMap<String, u32>,
    record_author: HashMap<String, String>,
    record_speaks: HashMap<String, String>,
    answers: HashMap<String, Vec<u32>>,
    pub seat_acts: Vec<SeatAct>,
    seat_act_by_action: HashMap<usize, usize>,
    pos_org: HashMap<String, String>,
    org_premises: HashMap<String, Vec<usize>>,
    pub genesis: HashMap<String, Value>,
    pub pilot: Option<Arc<Value>>,
    pub version: u64,
    pub tracks_cache: Mutex<Option<(u64, Arc<Tracks>)>>,
}

impl Inner {
    // ---- applying a line

    pub fn apply(&mut self, item: Item) {
        self.lines += 1;
        self.version += 1;
        match item {
            Item::Blank => {}
            Item::Header { line, v } => {
                if !self.have_header {
                    self.header(line, v);
                }
            }
            Item::End { t, reason, detail } => {
                self.last_t = self.last_t.max(t);
                self.end = Some((reason, detail, t));
            }
            Item::Skip { t } => self.time(t),
            Item::Line { line, kind, seq, t, v } => {
                self.time(t);
                if !self.have_header {
                    return;
                }
                match kind {
                    Kind::Command => self.command(line, seq, t, v),
                    Kind::Annotation => self.annotation(line, seq, t, v),
                    Kind::Event => self.event(line, seq, t, v),
                    Kind::Other => {}
                }
            }
        }
    }

    fn time(&mut self, t: i64) {
        self.last_t = self.last_t.max(t);
        if !self.have_header {
            return;
        }
        while t >= (self.day + 1) * DAY {
            self.snapshot();
        }
    }

    fn snapshot(&mut self) {
        self.day += 1;
        self.snaps.push(Snap {
            where_: self.where_.clone(),
            money: self.money.clone(),
            agency: self.agency.clone(),
            moves: self.moves.len() / MOVE_INTS,
        });
    }

    fn code_of(&mut self, n: &str) -> u32 {
        if let Some(&c) = self.name_code.get(n) {
            return c;
        }
        let c = self.names.len() as u32;
        self.name_code.insert(n.to_string(), c);
        self.names.push(n.to_string());
        c
    }

    fn keep(&mut self, line: String, seq: i64, t: i64, name: &str, action: i64, who: i64) -> u32 {
        let ord = self.metas.len() as u32;
        let name = self.code_of(name);
        self.metas.push(LineMeta { seq: seq as i32, t: t as i32, action: action as i32, name, who: who as i32 });
        self.store.push(line);
        ord
    }

    fn part(&mut self, id: &str) -> usize {
        if let Some(&i) = self.part_idx.get(id) {
            return i;
        }
        let i = self.part_ids.len();
        self.part_idx.insert(id.to_string(), i);
        self.part_ids.push(id.to_string());
        let cls = class_of(self.header_part.get(id), id);
        self.part_cls.push(cls);
        self.known.insert(id.to_string());
        i
    }

    fn holder(&mut self, id: &str) -> usize {
        if let Some(&i) = self.holder_idx.get(id) {
            return i;
        }
        let i = self.holders.len();
        self.holder_idx.insert(id.to_string(), i);
        self.holders.push(id.to_string());
        self.money.push(0);
        i
    }

    fn add_person(&mut self, id: &str, participant: Option<&str>) -> usize {
        if let Some(&i) = self.person_idx.get(id) {
            return i;
        }
        let i = self.persons.len();
        self.person_idx.insert(id.to_string(), i);
        self.persons.push(id.to_string());
        self.holder(id);
        self.known.insert(id.to_string());
        if let Some(p) = participant.filter(|p| !p.is_empty()) {
            self.part(p);
            self.participant_person.insert(p.to_string(), id.to_string());
        }
        self.where_.push(0);
        self.home.push(-1);
        self.last.push(-1);
        self.agency.push(-1);
        i
    }

    fn person_of(&self, p: &str) -> String {
        self.participant_person.get(p).cloned().unwrap_or_else(|| person_of_participant(p).to_string())
    }

    fn space(&mut self, id: &str) -> usize {
        if let Some(&i) = self.space_idx.get(id) {
            return i;
        }
        let (structure, kind, n) = space_parts(id);
        let nstruct = self.world.as_ref().map(|w| w.structures.len()).unwrap_or(0);
        let st = match self.struct_idx.get(&structure) {
            Some(&s) => s,
            None => {
                let s = nstruct + self.extra_structures.len();
                self.struct_idx.insert(structure.clone(), s);
                self.extra_structures.push(structure);
                s
            }
        };
        let i = self.spaces.len();
        self.space_idx.insert(id.to_string(), i);
        self.spaces.push(Space { id: id.to_string(), st, kind, n });
        i
    }

    fn set_account(&mut self, acc: &str, holder: &str) {
        match self.acc_idx.get(acc) {
            Some(&i) => self.accounts[i].1 = holder.to_string(),
            None => {
                self.acc_idx.insert(acc.to_string(), self.accounts.len());
                self.accounts.push((acc.to_string(), holder.to_string()));
            }
        }
    }
    fn acc_holder(&self, acc: &str) -> Option<&str> {
        self.acc_idx.get(acc).map(|&i| self.accounts[i].1.as_str())
    }

    fn header(&mut self, line: String, v: Value) {
        let h = v.get("body").cloned().unwrap_or(Value::Null);
        self.have_header = true;
        self.head_hash = gs(&v, "hash").unwrap_or("").to_string();
        let world = world_of(&h);
        self.struct_idx = world.structures.iter().enumerate().map(|(i, s)| (s.id.clone(), i)).collect();
        if let Some(Value::Array(ps)) = h.get("config").and_then(|c| c.get("participants")) {
            for p in ps {
                self.header_part.insert(jstr(p.get("id")), p.clone());
            }
        }
        for p in &world.participants {
            self.part(&p.id);
            if p.cls == Decider::Seat && self.seat_set.insert(p.id.clone()) {
                self.seats.push(p.id.clone());
            }
        }
        for p in &world.persons {
            self.add_person(&p.id, Some(&p.participant));
        }
        for o in &world.orgs {
            self.holder(&o.id);
            self.known.insert(o.id.clone());
            self.org_premises.insert(o.id.clone(), o.premises.clone());
        }
        for p in &world.posts {
            self.known.insert(p.id.clone());
            if let Some(e) = &p.entity {
                self.pos_org.insert(p.id.clone(), e.clone());
            }
        }
        for (id, holder, balance) in accounts_of(&h) {
            self.set_account(&id, &holder);
            self.known.insert(id);
            let hi = self.holder(&holder);
            self.money[hi] += balance.trim().parse::<i64>().unwrap_or(0);
        }
        for s in &world.structures {
            self.known.insert(s.id.clone());
        }
        if let Some(Value::Array(rs)) = h.get("config").and_then(|c| c.get("world")).and_then(|w| w.get("records")) {
            for r in rs {
                if let Some(id) = g(r, "id").filter(|x| truthy(Some(x))) {
                    let id = jstr(Some(id));
                    self.record_author.insert(id.clone(), "genesis".into());
                    if let Some(sf) = g(r, "speaks_for").filter(|x| truthy(Some(x))) {
                        self.record_speaks.insert(id.clone(), jstr(Some(sf)));
                    }
                    self.known.insert(id.clone());
                    self.genesis.insert(id, r.clone());
                }
            }
        }
        let occupancy = world.occupancy.clone();
        self.world = Some(world);
        for (occupant, sp) in &occupancy {
            let Some(&pi) = self.person_idx.get(occupant) else { continue };
            let si = self.space(sp);
            self.where_[pi] = si as u32 + 1;
            self.last[pi] = self.spaces[si].st as i64;
            if self.spaces[si].kind == "dwelling" {
                self.home[pi] = self.spaces[si].st as i64;
            }
        }
        let _ = line;
        self.snapshot_first();
    }

    fn snapshot_first(&mut self) {
        self.day = 0;
        self.snaps.push(Snap { where_: self.where_.clone(), money: self.money.clone(), agency: self.agency.clone(), moves: 0 });
    }

    // ---- who decided

    fn decider(&self, action: i64, instruction: Option<&str>) -> Option<String> {
        if let Some(ins) = instruction.filter(|s| !s.is_empty()) {
            if let Some(a) = self.record_author.get(ins) {
                if !a.is_empty() && a != "genesis" {
                    return Some(a.clone());
                }
            }
            if let Some(sp) = self.record_speaks.get(ins) {
                return Some(if self.person_idx.contains_key(sp) { format!("{sp}-self") } else { format!("{sp}#org") });
            }
        }
        if action < 0 {
            return None;
        }
        Some(self.part_ids[self.actions[action as usize][1] as usize].clone())
    }

    fn cls_for(&self, p: &str, by: Option<&str>) -> usize {
        let Some(by) = by.filter(|b| !b.is_empty()) else { return class_code(Decider::World) };
        if by.ends_with("#org") {
            return class_code(Decider::System);
        }
        if self.person_of(by) == p {
            return class_code(Decider::Own);
        }
        match self.part_idx.get(by) {
            Some(&i) => class_code(self.part_cls[i]),
            None => class_code(class_of(None, by)),
        }
    }

    fn struct_for(&self, id: &str) -> i64 {
        if let Some(&pi) = self.person_idx.get(id) {
            let s = self.where_[pi];
            if self.home[pi] >= 0 {
                return self.home[pi];
            }
            return if s != 0 { self.spaces[s as usize - 1].st as i64 } else { self.last[pi] };
        }
        self.org_premises.get(id).and_then(|p| p.first()).map(|&x| x as i64).unwrap_or(-1)
    }

    fn pulse(&mut self, t: i64, person: &str, cls: usize, hard: bool, seat: bool, ord: u32) {
        let Some(&pi) = self.person_idx.get(person) else { return };
        let st = self.struct_for(person);
        self.pulses.extend_from_slice(&[t as i32, pi as i32, st as i32, cls as i32, i32::from(hard) | (i32::from(seat) << 1), ord as i32]);
    }

    fn who_idx(&mut self, by: Option<&str>) -> i64 {
        match by.filter(|b| !b.is_empty()) {
            Some(b) => self.part(b.strip_suffix("#org").unwrap_or(b)) as i64,
            None => -1,
        }
    }

    // ---- postings

    fn post(&mut self, id: &str, ord: u32) {
        match self.postings.get_mut(id) {
            None => {
                self.postings.insert(id.to_string(), vec![ord]);
            }
            Some(p) => {
                if p.last() != Some(&ord) {
                    p.push(ord);
                }
            }
        }
    }

    /// Posts `ord` under every known id the line's body names (as a quoted string, key or value).
    fn post_tokens(&mut self, v: &Value, ord: u32) {
        let mut hits: Vec<String> = vec![];
        if let Some(body) = v.get("body") {
            let known = &self.known;
            walk_tokens(body, &mut |s| {
                if known.contains(s) {
                    hits.push(s.to_string());
                }
            });
        }
        for h in hits {
            self.post(&h, ord);
        }
    }

    // ---- lines

    fn command(&mut self, line: String, seq: i64, t: i64, v: Value) {
        let b = v.get("body").cloned().unwrap_or(Value::Null);
        let name = gs(&b, "command").unwrap_or("?").to_string();
        if name == "act" {
            let participant = jstr(b.get("participant"));
            let pi = self.part(&participant) as i64;
            let ord = self.keep(line, seq, t, "act", -1, pi);
            self.act_ord_by_seq.insert(seq, ord);
            self.post_tokens(&v, ord);
            if self.seat_set.contains(&participant) {
                let blocks: &[Value] = match b.get("blocks") {
                    Some(Value::Array(a)) => a,
                    _ => &[],
                };
                let kinds = blocks
                    .iter()
                    .map(|x| {
                        format!(
                            "{}{}",
                            jstr(x.get("block")),
                            g(x, "kind").filter(|k| truthy(Some(k))).map(|k| format!(":{}", jstr(Some(k)))).unwrap_or_default()
                        )
                    })
                    .collect();
                let text = take_chars(
                    &blocks
                        .iter()
                        .filter_map(|x| g(x, "text").filter(|k| truthy(Some(k))).map(|k| jstr(Some(k))))
                        .collect::<Vec<_>>()
                        .join(" / "),
                    300,
                );
                let as_v = g(&b, "as");
                let org = as_v.filter(|a| truthy(Some(a))).and_then(|a| self.pos_org.get(&jstr(Some(a))).cloned());
                let from = org.and_then(|o| self.org_premises.get(&o).and_then(|p| p.first()).map(|&x| x as i64)).unwrap_or(-1);
                let prov = b.get("provenance");
                self.seat_acts.push(SeatAct {
                    ord,
                    seq,
                    t,
                    participant,
                    as_: jstr0(as_v),
                    draft: prov.and_then(|p| g(p, "draft")).map(|d| jstr(Some(d))),
                    via: prov.and_then(|p| g(p, "via")).map(|d| jstr(Some(d))),
                    action: -1,
                    kinds,
                    text,
                    from,
                    targets: vec![],
                });
            }
            return;
        }
        let participant = gs(&b, "participant").map(String::from);
        if name == "entity_record" {
            let who = participant.as_deref().map(|p| self.part(p) as i64).unwrap_or(-1);
            let ord = self.keep(line, seq, t, "entity_record", -1, who);
            if let Some(p) = participant {
                self.post(&p, ord);
                let now = b.get("set").and_then(|s| s.get("agency")).and_then(|a| a.get("now")).and_then(crate::js::num_i64);
                let pid = self.person_of(&p);
                if let (Some(now), Some(&pi)) = (now, self.person_idx.get(&pid)) {
                    self.agency[pi] = now.clamp(-1, 32767) as i16;
                }
            }
            return;
        }
        let who = participant.as_deref().map(|p| self.part(p) as i64).unwrap_or(-1);
        let ord = self.keep(line, seq, t, &name, -1, who);
        self.post_tokens(&v, ord);
    }

    fn annotation(&mut self, line: String, seq: i64, t: i64, v: Value) {
        let b = v.get("body").cloned().unwrap_or(Value::Null);
        let name = gs(&b, "annotation").unwrap_or("?").to_string();
        let ord = self.keep(line, seq, t, &format!("annotation:{name}"), -1, -1);
        if name == "decision" || name == "outcome" {
            if let Some(s) = gs(&b, "subject").filter(|s| !s.is_empty()) {
                self.post(s, ord);
            }
        } else {
            self.post_tokens(&v, ord);
        }
    }

    fn touched_target(&mut self, sa: Option<usize>, id: &str) {
        let Some(sa) = sa else { return };
        let pid = if self.person_idx.contains_key(id) {
            Some(id.to_string())
        } else if let Some(p) = self.participant_person.get(id) {
            Some(p.clone())
        } else if self.person_idx.contains_key(person_of_participant(id)) {
            Some(person_of_participant(id).to_string())
        } else {
            None
        };
        if let Some(pid) = pid {
            self.target(sa, &pid, "person");
        } else if self.org_premises.contains_key(id) {
            self.target(sa, id, "org");
        } else if let Some(o) = self.pos_org.get(id).cloned() {
            self.target(sa, &o, "org");
        }
    }
    fn target(&mut self, sa: usize, id: &str, kind: &'static str) {
        if self.seat_acts[sa].targets.len() < 40 && !self.seat_acts[sa].targets.iter().any(|x| x.id == id) {
            let st = self.struct_for(id);
            self.seat_acts[sa].targets.push(Target { id: id.to_string(), kind, st });
        }
    }
    fn pid_of_touched(&self, x: &str) -> Option<String> {
        if self.person_idx.contains_key(x) {
            Some(x.to_string())
        } else if let Some(p) = self.participant_person.get(x) {
            Some(p.clone())
        } else if self.person_idx.contains_key(person_of_participant(x)) {
            Some(person_of_participant(x).to_string())
        } else {
            None
        }
    }

    fn event(&mut self, line: String, seq: i64, t: i64, v: Value) {
        let b = v.get("body").cloned().unwrap_or(Value::Null);
        let name = gs(&b, "event").unwrap_or("?").to_string();
        let name = name.as_str();
        if name == "action_started" {
            let Some(action) = gs(&b, "action") else { return };
            let cause = gi(&b, "cause").unwrap_or(-1);
            let act_ord = self.act_ord_by_seq.get(&cause).map(|&o| o as i64).unwrap_or(-1);
            let participant = gs(&b, "participant").unwrap_or("").to_string();
            let pi = self.part(&participant);
            let i = self.actions.len();
            self.actions.push([act_ord as i32, pi as i32, 0, t as i32]);
            self.action_idx.insert(action.to_string(), i);
            if let Some(last) = self.seat_acts.len().checked_sub(1) {
                if self.seat_acts[last].ord as i64 == act_ord {
                    self.seat_acts[last].action = i as i64;
                    self.seat_act_by_action.insert(i, last);
                }
            }
            return;
        }
        if name == "action_applied" {
            let Some(&i) = gs(&b, "action").and_then(|a| self.action_idx.get(a)) else { return };
            let cause = gi(&b, "cause").unwrap_or(-1);
            self.actions[i][2] = 1;
            self.actions[i][3] = t as i32;
            self.applied_by_cause.insert(cause, i);
            let who = self.part_ids[self.actions[i][1] as usize].clone();
            if let Some(Value::Array(by)) = b.get("by") {
                let by: Vec<String> = by.iter().map(|x| jstr(Some(x))).collect();
                if !by.is_empty() && (by.len() != 1 || by[0] != who) {
                    self.performers.insert(i, by.join(","));
                }
            }
            return;
        }
        if name == "occupied" {
            let occ = gs(&b, "occupant").unwrap_or("");
            let sp = gs(&b, "space").unwrap_or("");
            let Some(&pi) = self.person_idx.get(occ) else { return };
            if sp.is_empty() {
                return;
            }
            let si = self.space(sp);
            self.where_[pi] = si as u32 + 1;
            self.last[pi] = self.spaces[si].st as i64;
            if self.spaces[si].kind == "dwelling" {
                self.home[pi] = self.spaces[si].st as i64;
            }
            self.moves.extend_from_slice(&[t as i32, pi as i32, si as i32 + 1]);
            return;
        }

        let cause = gi(&b, "cause");
        let action: i64 = match cause {
            Some(c) if ACTED.contains(&name) => self.applied_by_cause.get(&c).map(|&i| i as i64).unwrap_or(-1),
            _ => -1,
        };
        let sa: Option<usize> = if action >= 0 { self.seat_act_by_action.get(&(action as usize)).copied() } else { None };

        if name == "vacated" {
            let occ = jstr(b.get("occupant"));
            let pi = self.person_idx.get(&occ).copied();
            if let Some(pi) = pi {
                self.where_[pi] = 0;
                self.moves.extend_from_slice(&[t as i32, pi as i32, 0]);
            }
            let reason = g(&b, "reason").filter(|r| truthy(Some(r)));
            match reason.and_then(Value::as_str) {
                Some("left") | Some("died") | None => return,
                _ => {}
            }
            let by = gs(&b, "by").map(String::from).or_else(|| self.decider(action, None));
            let who = self.who_idx(by.as_deref());
            let ord = self.keep(line, seq, t, name, action, who);
            self.post_tokens(&v, ord);
            if pi.is_some() {
                let c = self.cls_for(&occ, by.as_deref());
                self.pulse(t, &occ, c, true, sa.is_some(), ord);
            }
            return;
        }

        let instruction = gs(&b, "per_instruction");
        let effect_by: Option<String> = if name == "transfer" {
            self.decider(action, instruction)
        } else if name == "recorded" {
            match b.get("record").and_then(|r| g(r, "author")).filter(|a| truthy(Some(a))) {
                Some(a) => Some(jstr(Some(a))),
                None => self.decider(action, None),
            }
        } else {
            match g(&b, "by") {
                Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
                _ => self.decider(action, None),
            }
        };
        let who = match effect_by.as_deref() {
            Some(e) if !e.is_empty() && e != "genesis" => self.who_idx(Some(e)),
            _ => -1,
        };
        let ord = self.keep(line, seq, t, name, action, who);
        self.post_tokens(&v, ord);
        match name {
            "transfer" => {
                let amt = crate::js::number(b.get("amount")).filter(|f| f.is_finite()).map(|f| f as i64).unwrap_or(0);
                let from = gs(&b, "from").map(String::from);
                let to = gs(&b, "to").map(String::from);
                for (acc, sign) in [(&from, -1i64), (&to, 1i64)] {
                    if let Some(h) = acc.as_deref().and_then(|a| self.acc_holder(a)).map(String::from) {
                        let hi = self.holder(&h);
                        self.money[hi] += sign * amt;
                    }
                }
                let by = self.decider(action, instruction);
                let seat = sa.is_some() || by.as_deref().map(|b| self.seat_set.contains(b)).unwrap_or(false);
                let hard = memo_is_hard(&jstr0(b.get("memo")));
                for acc in [&from, &to] {
                    let h = acc.as_deref().and_then(|a| self.acc_holder(a)).map(String::from);
                    if let Some(h) = h {
                        if self.person_idx.contains_key(&h) {
                            let c = self.cls_for(&h, by.as_deref());
                            self.pulse(t, &h, c, hard, seat, ord);
                        }
                        self.touched_target(sa, &h);
                    }
                }
            }
            "recorded" => {
                let r = b.get("record").cloned().unwrap_or(Value::Null);
                if let Some(id) = g(&r, "id").filter(|x| truthy(Some(x))) {
                    let id = jstr(Some(id));
                    self.record_ord.insert(id.clone(), ord);
                    self.record_author.insert(id.clone(), jstr0(r.get("author")));
                    if let Some(sf) = g(&r, "speaks_for").filter(|x| truthy(Some(x))) {
                        self.record_speaks.insert(id.clone(), jstr(Some(sf)));
                    }
                    if !self.known.contains(&id) {
                        self.known.insert(id.clone());
                        self.post(&id, ord);
                    }
                }
                for bs in list(r.get("basis")) {
                    self.answers.entry(bs).or_default().push(ord);
                }
                let mut touched: Vec<String> = vec![];
                let mut add = |x: String| {
                    if !touched.contains(&x) {
                        touched.push(x)
                    }
                };
                for x in list(r.get("addressed_to")) {
                    add(x);
                }
                for x in list(r.get("terms").and_then(|t| t.get("parties"))) {
                    add(x);
                }
                if gs(&r, "record") == Some("claim") && truthy(r.get("holder")) {
                    add(jstr(r.get("holder")));
                }
                let by: Option<String> = match g(&r, "author").filter(|a| truthy(Some(a))) {
                    Some(a) => Some(jstr(Some(a))),
                    None => self.decider(action, None),
                };
                let consequential = is_consequential_record(gs(&r, "kind"), gs(&r, "record"));
                let hard = is_hard(gs(&r, "kind"), r.get("data"), gs(&r, "text"));
                for x in touched {
                    let pid = self.pid_of_touched(&x);
                    if let Some(pid) = pid {
                        if consequential {
                            let c = self.cls_for(&pid, by.as_deref());
                            let seat = sa.is_some() || by.as_deref().map(|b| !b.is_empty() && self.seat_set.contains(b)).unwrap_or(false);
                            self.pulse(t, &pid, c, hard, seat, ord);
                        }
                    }
                    self.touched_target(sa, &x);
                }
            }
            "action_refused" => {
                if let Some(&i) = self.action_idx.get(&jstr(b.get("action"))) {
                    self.actions[i][2] = 2;
                    self.actions[i][3] = t as i32;
                    self.metas[ord as usize].action = i as i32;
                }
            }
            "message_delivered" => {
                for x in list(b.get("to")) {
                    self.touched_target(sa, &x);
                }
            }
            "person_created" | "person_arrived" => {
                let id = jstr(b.get("person"));
                self.add_person(&id, gs(&b, "participant"));
            }
            "participant_created" => {
                let p = jstr(b.get("participant"));
                self.part(&p);
                if truthy(b.get("person")) {
                    self.participant_person.insert(p, jstr(b.get("person")));
                }
            }
            "account_opened" => {
                let acc = jstr(b.get("account"));
                let holder = jstr(b.get("holder"));
                self.set_account(&acc, &holder);
                self.known.insert(acc);
                self.holder(&holder);
            }
            "entity_created" => {
                let e = jstr(b.get("entity"));
                self.known.insert(e.clone());
                self.holder(&e);
            }
            "position_created" => {
                let pos = jstr(b.get("position"));
                self.known.insert(pos.clone());
                if truthy(b.get("entity")) {
                    self.pos_org.insert(pos, jstr(b.get("entity")));
                }
                let prem = b.get("role_module").and_then(|m| m.get("params")).and_then(|p| g(p, "premises")).filter(|p| truthy(Some(p)));
                let si = prem.and_then(|p| self.struct_idx.get(&jstr(Some(p))).copied());
                if let (Some(si), true) = (si, truthy(b.get("entity"))) {
                    self.org_premises.insert(jstr(b.get("entity")), vec![si]);
                }
            }
            "person_died" | "person_left" => {
                let p = jstr(b.get("person"));
                if self.person_idx.contains_key(&p) {
                    let c = if name == "person_left" { self.cls_for(&p, gs(&b, "by")) } else { class_code(Decider::World) };
                    self.pulse(t, &p, c, name == "person_died", false, ord);
                }
            }
            "condition_began" => {
                let p = jstr(b.get("person"));
                self.pulse(t, &p, class_code(Decider::World), true, false, ord);
            }
            _ => {}
        }
    }

    // ---- reading

    pub fn kept(&self) -> usize {
        self.metas.len()
    }
    pub fn text(&self, ord: u32) -> Option<String> {
        if (ord as usize) < self.metas.len() {
            self.store.text(ord as usize)
        } else {
            None
        }
    }
    pub fn line(&self, ord: u32) -> Option<Value> {
        serde_json::from_str(&self.text(ord)?).ok()
    }
    pub fn seq(&self, ord: u32) -> i64 {
        self.metas[ord as usize].seq as i64
    }
    pub fn t(&self, ord: u32) -> i64 {
        self.metas[ord as usize].t as i64
    }
    pub fn action_of(&self, ord: u32) -> i64 {
        self.metas[ord as usize].action as i64
    }
    pub fn name_of(&self, ord: u32) -> &str {
        &self.names[self.metas[ord as usize].name as usize]
    }
    pub fn who_of(&self, ord: u32) -> Option<&str> {
        let w = self.metas[ord as usize].who;
        if w >= 0 {
            self.part_ids.get(w as usize).map(String::as_str)
        } else {
            None
        }
    }
    pub fn action(&self, i: usize) -> ActionRef {
        let a = &self.actions[i];
        ActionRef {
            act: a[0] as u32,
            participant: self.part_ids.get(a[1] as usize).cloned().unwrap_or_else(|| "?".into()),
            status: ["pending", "applied", "refused"].get(a[2] as usize).unwrap_or(&"?").to_string(),
            end_t: a[3] as i64,
        }
    }
    pub fn performers_of(&self, i: usize) -> Option<Vec<String>> {
        self.performers.get(&i).map(|s| s.split(',').map(String::from).collect())
    }
    pub fn postings(&self, id: &str) -> &[u32] {
        self.postings.get(id).map(Vec::as_slice).unwrap_or(&[])
    }
    pub fn postings_of(&self, ids: &[String]) -> Vec<u32> {
        let mut s: Vec<u32> = ids.iter().flat_map(|id| self.postings(id).iter().copied()).collect();
        s.sort_unstable();
        s.dedup();
        s
    }
    /// A record by id: the line that made it, or the header's copy for one made before the run.
    pub fn record(&self, id: &str) -> Option<(Option<u32>, Value)> {
        if let Some(&o) = self.record_ord.get(id) {
            let rec = self.line(o)?.get("body").and_then(|b| b.get("record")).cloned().unwrap_or(Value::Null);
            return Some((Some(o), rec));
        }
        self.genesis.get(id).map(|r| (None, r.clone()))
    }
    pub fn answers(&self, id: &str) -> &[u32] {
        self.answers.get(id).map(Vec::as_slice).unwrap_or(&[])
    }
    pub fn cls_of(&self, participant: &str, about: Option<&str>) -> Decider {
        if let Some(a) = about.filter(|a| !a.is_empty()) {
            if person_of_participant(participant) == a {
                return Decider::Own;
            }
        }
        if let Some(&i) = self.part_idx.get(participant) {
            return self.part_cls[i];
        }
        if participant.ends_with("-self") {
            Decider::Person
        } else if participant == "genesis" {
            Decider::World
        } else {
            Decider::System
        }
    }
    pub fn participant_info(&self, id: &str) -> Option<&crate::world::ParticipantInfo> {
        self.world.as_ref()?.participants.iter().find(|p| p.id == id)
    }
    pub fn world(&self) -> &WorldStatic {
        self.world.as_ref().expect("the header has been read")
    }
    pub fn days(&self) -> usize {
        ((self.last_t as f64 / DAY as f64).ceil() as i64).max(1) as usize
    }
    pub fn space_at(&self, s1: u32) -> Option<&Space> {
        if s1 == 0 {
            None
        } else {
            self.spaces.get(s1 as usize - 1)
        }
    }
    pub fn struct_name(&self, st: usize) -> Option<String> {
        let w = self.world();
        w.structures
            .get(st)
            .map(|s| s.id.clone())
            .or_else(|| st.checked_sub(w.structures.len()).and_then(|i| self.extra_structures.get(i).cloned()))
    }

    /// The tracks laid out by day (cached until the index grows).
    pub fn tracks(&self) -> Arc<Tracks> {
        let mut c = self.tracks_cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((v, t)) = c.as_ref() {
            if *v == self.version {
                return t.clone();
            }
        }
        let t = Arc::new(self.build_tracks());
        *c = Some((self.version, t.clone()));
        t
    }

    fn build_tracks(&self) -> Tracks {
        let days = self.days();
        let p = self.persons.len();
        let h = self.holders.len();
        // Persons first (in person order), then every other holder in the order first seen.
        let mut holder_pos = vec![usize::MAX; h];
        let mut holder_ids: Vec<String> = Vec::with_capacity(h);
        for id in &self.persons {
            holder_pos[self.holder_idx[id]] = holder_ids.len();
            holder_ids.push(id.clone());
        }
        for (hi, id) in self.holders.iter().enumerate() {
            if holder_pos[hi] == usize::MAX {
                holder_pos[hi] = holder_ids.len();
                holder_ids.push(id.clone());
            }
        }
        let mut where_ = vec![0u32; (days + 1) * p];
        let mut agency = vec![-1i16; (days + 1) * p];
        let mut money = vec![0i64; (days + 1) * h];
        let mut moves_day = Vec::with_capacity(days + 2);
        let now_moves = self.moves.len() / MOVE_INTS;
        for d in 0..=days {
            let (w, m, a, mv): (&[u32], &[i64], &[i16], usize) = match self.snaps.get(d) {
                Some(s) => (&s.where_, &s.money, &s.agency, s.moves),
                None => (&self.where_, &self.money, &self.agency, now_moves),
            };
            let n = w.len().min(p);
            where_[d * p..d * p + n].copy_from_slice(&w[..n]);
            let n = a.len().min(p);
            agency[d * p..d * p + n].copy_from_slice(&a[..n]);
            for (hi, v) in m.iter().enumerate().take(h) {
                money[d * h + holder_pos[hi]] = *v;
            }
            moves_day.push(mv);
        }
        moves_day.push(now_moves);
        Tracks { days, persons: p, holders: h, where_, money, agency, moves_day, holder_pos, holder_ids }
    }

    /// Every person's space index + 1 (0: in none) at time t: the day's midnight, then that day's moves up to t.
    pub fn where_at(&self, t: i64) -> Vec<u32> {
        let tr = self.tracks();
        let p = tr.persons;
        let d = ((t as f64 / DAY as f64).floor() as i64).clamp(0, tr.days as i64) as usize;
        let mut out = tr.where_[d * p..(d + 1) * p].to_vec();
        let from = tr.moves_day.get(d).copied().unwrap_or(0);
        let to = tr.moves_day.get(d + 1).copied().unwrap_or(self.moves.len() / MOVE_INTS);
        for i in from..to {
            let m = i * MOVE_INTS;
            if self.moves[m] as i64 > t {
                break;
            }
            if let Some(slot) = out.get_mut(self.moves[m + 1] as usize) {
                *slot = self.moves[m + 2] as u32;
            }
        }
        out
    }
    pub fn series_money(&self, holder_id: &str) -> Vec<i64> {
        let tr = self.tracks();
        let Some(&hi) = self.holder_idx.get(holder_id) else { return vec![] };
        let pos = tr.holder_pos[hi];
        (0..=tr.days).map(|d| tr.money[d * tr.holders + pos]).collect()
    }
    pub fn series_agency(&self, pi: usize) -> Vec<i64> {
        let tr = self.tracks();
        (0..=tr.days).map(|d| tr.agency[d * tr.persons + pi] as i64).collect()
    }
    /// The pulses, newest first, that pass the filter.
    pub fn pulses_at(&self, filter: impl Fn(&Pulse) -> bool, limit: usize) -> Vec<Pulse> {
        let mut out = vec![];
        let n = self.pulses.len() / PULSE_INTS;
        for i in (0..n).rev() {
            if out.len() >= limit {
                break;
            }
            let k = i * PULSE_INTS;
            let p = Pulse {
                t: self.pulses[k] as i64,
                person: self.pulses[k + 1] as usize,
                st: self.pulses[k + 2] as i64,
                cls: self.pulses[k + 3] as usize,
                flags: self.pulses[k + 4],
                ord: self.pulses[k + 5] as u32,
            };
            if filter(&p) {
                out.push(p);
            }
        }
        out
    }
    /// A seat act's status ("applied", "refused", "pending", "not started") and end time.
    pub fn seat_act_status(&self, a: &SeatAct) -> (String, Option<i64>) {
        if a.action < 0 {
            return ("not started".into(), None);
        }
        let x = &self.actions[a.action as usize];
        (["pending", "applied", "refused"].get(x[2] as usize).unwrap_or(&"?").to_string(), Some(x[3] as i64))
    }
    pub fn class_of_code(c: usize) -> Decider {
        class_of_code(c)
    }
}

#[derive(Clone, Debug)]
pub struct Pulse {
    pub t: i64,
    pub person: usize,
    pub st: i64,
    pub cls: usize,
    pub flags: i32,
    pub ord: u32,
}

/// Calls `f` with every string in a JSON value that could be an id (keys and values) and is short enough to be one.
fn walk_tokens(v: &Value, f: &mut impl FnMut(&str)) {
    fn token(s: &str) -> bool {
        let b = s.as_bytes();
        !b.is_empty()
            && b.len() <= 81
            && b[0].is_ascii_alphanumeric()
            && b.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-' | b'/'))
    }
    match v {
        Value::String(s) => {
            if token(s) {
                f(s)
            }
        }
        Value::Array(a) => a.iter().for_each(|x| walk_tokens(x, f)),
        Value::Object(m) => {
            for (k, x) in m {
                if token(k) {
                    f(k)
                }
                walk_tokens(x, f);
            }
        }
        _ => {}
    }
}
