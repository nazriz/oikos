//! What the explorer's panels show, at a moment t (renderer/src/panels.ts): a person's life, an organisation (its
//! posts, staff, acts and backlog), a building, a seat's act set beside its sitting and its twin, the town's pulse.
//! Raw quantities and the log's own words; nothing is scored.

use crate::consequential::{is_consequential_record, is_hard, memo_is_hard};
use crate::inner::{Inner, DAY};
use crate::js::{g, gs, jstr, jstr0, list, num_i64, take_chars, truthy, Obj};
use crate::trace::{describe, event_row, trace};
use crate::world::{class_name, person_of_participant, CLASSES};
use crate::Decider;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const YEAR: i64 = 365 * DAY;
const ROUTINE_BLOCKS: [&str; 4] = ["occupy", "vacate", "work", "move_goods"];
const SKIP_IN_LIFE: [&str; 12] = [
    "annotation:decision",
    "annotation:outcome",
    "entity_record",
    "annotation:usage",
    "annotation:transcript",
    "annotation:note",
    "annotation:draft",
    "annotation:signoff",
    "annotation:translation_failure",
    "worked",
    "goods_moved",
    "body_changed",
];

fn floor_div(a: i64, b: i64) -> i64 {
    a.div_euclid(b)
}

fn space_at(s: &Inner, pi: usize, t: i64) -> Option<Value> {
    let w = s.where_at(t).get(pi).copied().unwrap_or(0);
    let sp = s.space_at(w)?;
    Some(Obj::new().set("space", sp.id.clone()).set("struct", sp.st).opt("structure", s.struct_name(sp.st)).build())
}

/// The dwelling a person slept in at the start of day d, or the latest before.
fn home_at(s: &Inner, pi: usize, t: i64) -> i64 {
    let tr = s.tracks();
    let p = tr.persons;
    let dwelling = |v: u32| s.space_at(v).filter(|sp| sp.kind == "dwelling").map(|sp| sp.st as i64);
    let start = floor_div(t, DAY).min(tr.days as i64);
    let mut d = start;
    while d >= 0 {
        if let Some(h) = dwelling(tr.where_[d as usize * p + pi]) {
            return h;
        }
        d -= 1;
    }
    let mut d = floor_div(t, DAY) + 1;
    while d >= 0 && d <= tr.days as i64 {
        if let Some(h) = dwelling(tr.where_[d as usize * p + pi]) {
            return h;
        }
        d += 1;
    }
    -1
}

fn is_hard_row(s: &Inner, ord: u32) -> bool {
    let n = s.name_of(ord);
    match n {
        "recorded" => {
            let line = s.line(ord).unwrap_or(Value::Null);
            let r = line.get("body").and_then(|b| b.get("record")).cloned().unwrap_or(Value::Null);
            is_consequential_record(gs(&r, "kind"), gs(&r, "record")) && is_hard(gs(&r, "kind"), r.get("data"), gs(&r, "text"))
        }
        "vacated" | "action_refused" | "condition_began" | "person_died" => true,
        "transfer" => {
            let line = s.line(ord).unwrap_or(Value::Null);
            memo_is_hard(&jstr0(line.get("body").and_then(|b| b.get("memo"))))
        }
        _ => false,
    }
}

fn by_class_zero() -> BTreeMap<&'static str, i64> {
    crate::world::CLASS_NAMES.iter().map(|c| (*c, 0)).collect()
}

pub fn person_panel(s: &Inner, id: &str, t: i64) -> Option<Value> {
    let pi = *s.person_idx.get(id)?;
    let w = s.world();
    let p = w.persons.iter().find(|x| x.id == id);
    let participant = p
        .map(|p| p.participant.clone())
        .or_else(|| w.participants.iter().find(|x| x.person.as_deref() == Some(id)).map(|x| x.id.clone()))
        .unwrap_or_else(|| format!("{id}-self"));
    let hh = w.households.iter().find(|h| h.members.iter().any(|m| m == id));
    let job = w.jobs.iter().find(|(_, emp, _)| emp == id);
    let accounts: Vec<String> = s.accounts.iter().filter(|(_, h)| h == id).map(|(a, _)| a.clone()).collect();
    // The person's own record at t: their changes folded in order.
    let mut sections = Map::new();
    let mut record_changes = 0;
    let mut ids = vec![id.to_string(), participant.clone()];
    ids.extend(accounts.iter().cloned());
    let ords = s.postings_of(&ids);
    for &o in s.postings(&participant) {
        if s.t(o) > t {
            break;
        }
        if s.name_of(o) == "entity_record" {
            if let Some(Value::Object(set)) = s.line(o).and_then(|l| l.get("body").and_then(|b| b.get("set")).cloned()) {
                for (k, v) in set {
                    sections.insert(k, v);
                }
            }
            record_changes += 1;
        }
    }
    let life: Vec<u32> = ords.iter().copied().filter(|&o| !SKIP_IN_LIFE.contains(&s.name_of(o))).collect();
    // (Their own comings and goings and work are the tracks' to show: the list keeps what they did that mattered, and what reached them.)
    let mut routine = 0;
    let tail = &life[life.len().saturating_sub(1500)..];
    let kept: Vec<u32> = tail
        .iter()
        .copied()
        .filter(|&o| {
            if s.name_of(o) != "act" || s.who_of(o) != Some(participant.as_str()) {
                return true;
            }
            let line = s.line(o).unwrap_or(Value::Null);
            let own = match line.get("body").and_then(|b| b.get("blocks")) {
                Some(Value::Array(a)) => a.iter().all(|b| gs(b, "block").map(|x| ROUTINE_BLOCKS.contains(&x)).unwrap_or(false)),
                _ => true,
            };
            if own {
                routine += 1;
            }
            !own
        })
        .collect();
    let kept = &kept[kept.len().saturating_sub(700)..];
    let mut by_class = by_class_zero();
    let mut rows = vec![];
    for &o in kept {
        let r = event_row(s, o, Some(id));
        if r.t <= t && !r.own && r.name != "act" {
            *by_class.entry(class_name(r.cls)).or_insert(0) += 1;
        }
        let mut v = r.to_value();
        v.as_object_mut().unwrap().insert("hard".into(), Value::Bool(is_hard_row(s, o)));
        rows.push(v);
    }
    let dead = s.postings(id).iter().copied().find(|&o| matches!(s.name_of(o), "person_died" | "person_left"));
    let age = p.and_then(|p| p.born.as_ref()).and_then(|b| crate::js::number(Some(b))).map(|b| ((t as f64 - b) / YEAR as f64).floor());
    let home = home_at(s, pi, t);
    Some(
        Obj::new()
            .set("id", id)
            .set("participant", participant.clone())
            .set("kind", "person")
            .opt("born", p.and_then(|p| p.born.clone()))
            .opt("age", age.map(crate::js::num))
            .opt("sex", p.and_then(|p| p.sex.clone()))
            .opt(
                "household",
                hh.map(|h| {
                    Obj::new().set("id", h.id.clone()).set("members", h.members.clone()).opt("leaseholder", h.leaseholder.clone()).build()
                }),
            )
            .opt("now", space_at(s, pi, t))
            .opt(
                "home",
                if home >= 0 {
                    Some(Obj::new().set("struct", home).opt("structure", w.structures.get(home as usize).map(|x| x.id.clone())).build())
                } else {
                    None
                },
            )
            .opt(
                "job",
                job.map(|(emp, _, st)| {
                    Obj::new()
                        .set("employer", emp.clone())
                        .set("struct", *st)
                        .opt("structure", w.structures.get(*st).map(|x| x.id.clone()))
                        .build()
                }),
            )
            .set("accounts", accounts)
            .set("money", s.series_money(id))
            .set("agency", s.series_agency(pi))
            .set("record", Obj::new().set("sections", Value::Object(sections)).set("changes", record_changes).build())
            .set("events", rows)
            .set("total", life.len())
            .set("routine", routine)
            .set("byClass", Value::Object(by_class.into_iter().map(|(k, v)| (k.to_string(), Value::from(v))).collect()))
            .opt("gone", dead.map(|o| Obj::new().set("t", s.t(o)).set("what", s.name_of(o)).build()))
            .opt("seat", s.seats.iter().find(|x| person_of_participant(x) == id).cloned())
            .build(),
    )
}

struct Addressed {
    ord: u32,
    id: Option<String>,
    kind: Option<String>,
    t: i64,
    from: String,
    text: String,
}
impl Addressed {
    fn to_value(&self, age: Option<i64>) -> Value {
        Obj::new()
            .set("ord", self.ord)
            .opt("id", self.id.clone())
            .opt("kind", self.kind.clone())
            .set("t", self.t)
            .set("from", self.from.clone())
            .set("text", self.text.clone())
            .opt("age", age)
            .build()
    }
}

pub fn org_panel(s: &Inner, id: &str, t: i64) -> Option<Value> {
    let w = s.world();
    let org = w.orgs.iter().find(|o| o.id == id)?;
    let posts: Vec<_> = w.posts.iter().filter(|p| p.entity.as_deref() == Some(id)).collect();
    let post_vals: Vec<Value> = posts
        .iter()
        .map(|p| {
            let info = p.holder.as_deref().and_then(|h| s.participant_info(h));
            Obj::new()
                .set("id", p.id.clone())
                .opt("title", p.title.clone())
                .opt("role", p.role.clone())
                .opt("holder", p.holder.clone())
                .opt("cls", p.holder.as_deref().map(|h| class_name(s.cls_of(h, None))))
                .opt("model", info.and_then(|i| i.model.clone()))
                .opt("code", p.code.clone())
                .build()
        })
        .collect();
    let where_ = s.where_at(t);
    let staff: Vec<Value> = w
        .jobs
        .iter()
        .filter(|(emp, _, _)| emp == id)
        .map(|(_, person, st)| {
            let wv = s.person_idx.get(person).map(|&pi| where_.get(pi).copied().unwrap_or(0)).unwrap_or(0);
            let here = s.space_at(wv).map(|sp| org.premises.contains(&sp.st)).unwrap_or(false);
            Obj::new().set("person", person.clone()).set("struct", *st).set("here", here).build()
        })
        .collect();
    // Acts in each of its posts, by week, by the class of who decided (from the index, no line read).
    let days = s.days();
    let weeks = (days as f64 / 7.0).ceil() as usize + 1;
    let mut acts_by_week: Vec<Vec<i64>> = CLASSES.iter().map(|_| vec![0; weeks]).collect();
    let post_ids: Vec<String> = posts.iter().map(|p| p.id.clone()).collect();
    let mut acts = 0;
    for o in s.postings_of(&post_ids) {
        if s.name_of(o) != "act" {
            continue;
        }
        let wk = (floor_div(s.t(o), 7 * DAY).max(0) as usize).min(weeks - 1);
        let c = s.who_of(o).map(|w| s.cls_of(w, None)).unwrap_or(Decider::World);
        acts_by_week[crate::world::class_code(c)][wk] += 1;
        acts += 1;
    }
    // Decisions it made (records speaking for it that decide), newest first, to t.
    let own = s.postings(id);
    let mut decisions: Vec<Value> = vec![];
    let mut addressed: Vec<Addressed> = vec![];
    let mut scanned = 0;
    for &o in own.iter().rev() {
        if scanned >= 6000 {
            break;
        }
        if s.t(o) > t || s.name_of(o) != "recorded" {
            continue;
        }
        scanned += 1;
        let line = s.line(o).unwrap_or(Value::Null);
        let r = line.get("body").and_then(|b| b.get("record")).cloned().unwrap_or(Value::Null);
        let speaks = gs(&r, "speaks_for");
        if speaks == Some(id) && is_consequential_record(gs(&r, "kind"), gs(&r, "record")) && decisions.len() < 60 {
            decisions.push(event_row(s, o, None).to_value());
        }
        // (its own reports to itself, books and staff reports, are not papers waiting on it)
        if speaks != Some(id) && list(r.get("addressed_to")).iter().any(|x| x == id) && addressed.len() < 800 {
            addressed.push(Addressed {
                ord: o,
                id: g(&r, "id").map(|v| jstr(Some(v))),
                kind: g(&r, "kind").or_else(|| g(&r, "record")).map(|v| jstr(Some(v))),
                t: s.t(o),
                from: g(&r, "speaks_for").or_else(|| g(&r, "author")).map(|v| jstr(Some(v))).unwrap_or_else(|| "?".into()),
                text: take_chars(&jstr0(r.get("text")), 200),
            });
        }
    }
    // Its backlog at t: papers addressed to it that nothing it wrote by t cites as basis (oldest first).
    let mut backlog: Vec<&Addressed> =
        addressed.iter().filter(|a| !a.id.as_deref().map(|i| s.answers(i).iter().any(|&o| s.t(o) <= t)).unwrap_or(false)).collect();
    backlog.sort_by_key(|a| a.t);
    let mut kinds: BTreeMap<String, i64> = BTreeMap::new();
    for b in &backlog {
        *kinds.entry(b.kind.clone().unwrap_or_else(|| "undefined".into())).or_insert(0) += 1;
    }
    let seat = posts.iter().find(|p| p.holder.as_deref().map(|h| s.cls_of(h, None) == Decider::Seat).unwrap_or(false));
    let money = if s.holder_idx.contains_key(id) { s.series_money(id) } else { vec![] };
    Some(
        Obj::new()
            .set("id", id)
            .set("kind", org.kind.clone())
            .set("name", org.name.clone())
            .set(
                "premises",
                org.premises
                    .iter()
                    .map(|&i| Obj::new().set("struct", i).opt("structure", w.structures.get(i).map(|x| x.id.clone())).build())
                    .collect::<Vec<_>>(),
            )
            .set("posts", post_vals)
            .set("staff", staff)
            .set("money", money)
            .set(
                "actsByWeek",
                Value::Object(
                    CLASSES.iter().enumerate().map(|(i, c)| (class_name(*c).to_string(), Value::from(acts_by_week[i].clone()))).collect(),
                ),
            )
            .set("acts", acts)
            .set("decisions", decisions)
            .set(
                "backlog",
                Obj::new()
                    .set("open", backlog.len())
                    .set("of", addressed.len())
                    .set("kinds", Value::Object(kinds.into_iter().map(|(k, v)| (k, Value::from(v))).collect()))
                    .set("oldest", backlog.iter().take(25).map(|b| b.to_value(Some(floor_div(t - b.t, DAY)))).collect::<Vec<_>>())
                    .build(),
            )
            .opt(
                "seat",
                seat.map(|p| {
                    Obj::new()
                        .opt("participant", p.holder.clone())
                        .set("post", p.id.clone())
                        .opt("model", s.participant_info(p.holder.as_deref().unwrap_or("")).and_then(|i| i.model.clone()))
                        .build()
                }),
            )
            .build(),
    )
}

pub fn building_panel(s: &Inner, idx: usize, t: i64) -> Option<Value> {
    let w = s.world();
    let st = w.structures.get(idx)?;
    let lot = w.lots.iter().find(|(_, cells)| cells.iter().any(|&(x, y)| x == st.x && y == st.y));
    let owner = lot.and_then(|(lid, _)| w.titles.iter().find(|(l, _)| l == lid).map(|(_, h)| h.clone()));
    let where_ = s.where_at(t);
    let mut inside = vec![];
    for (pi, &wv) in where_.iter().enumerate() {
        if let Some(sp) = s.space_at(wv) {
            if sp.st == idx {
                inside.push(Obj::new().set("person", s.persons[pi].clone()).set("space", sp.id.clone()).build());
            }
        }
    }
    let tr = s.tracks();
    let p = tr.persons;
    let d = floor_div(t, DAY).clamp(0, tr.days as i64) as usize;
    let mut residents = vec![];
    for pi in 0..p {
        if let Some(sp) = s.space_at(tr.where_[d * p + pi]) {
            if sp.st == idx && sp.kind == "dwelling" {
                residents.push(s.persons[pi].clone());
            }
        }
    }
    let recent: Vec<Value> = s
        .pulses_at(|q| q.st == idx as i64 && q.t <= t && q.t > t - 30 * DAY, 40)
        .into_iter()
        .map(|q| {
            let person = s.persons[q.person].clone();
            let mut v = event_row(s, q.ord, Some(&person)).to_value();
            let m = v.as_object_mut().unwrap();
            m.insert("person".into(), person.into());
            m.insert("hard".into(), (q.flags & 1 != 0).into());
            m.insert("seat".into(), (q.flags & 2 != 0).into());
            v
        })
        .collect();
    let used_by: Vec<Value> = w
        .orgs
        .iter()
        .filter(|o| o.premises.contains(&idx))
        .map(|o| Obj::new().set("id", o.id.clone()).set("name", o.name.clone()).set("kind", o.kind.clone()).build())
        .collect();
    Some(
        Obj::new()
            .set("id", st.id.clone())
            .set("struct", idx)
            .set("type", st.type_.clone())
            .set("category", st.category.clone())
            .set("x", st.x)
            .set("y", st.y)
            .set("spaces", st.spaces)
            .opt("lot", lot.map(|(l, _)| l.clone()))
            .opt("owner", owner)
            .set("usedBy", used_by)
            .set("inside", inside)
            .set("residents", residents)
            .set("recent", recent)
            .build(),
    )
}

/// A subset of an object's keys, those present and not null.
fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut o = Obj::new();
    for k in keys {
        if let Some(x) = v.get(*k) {
            o = o.set(k, x.clone());
        }
    }
    o.build()
}
fn arr(v: Option<&Value>) -> &[Value] {
    match v {
        Some(Value::Array(a)) => a,
        _ => &[],
    }
}
fn num_eq(a: Option<&Value>, b: i64) -> bool {
    a.and_then(num_i64) == Some(b)
}

/// The seat's act's JSON as the client reads it (`...a`, status and end time worked out).
pub fn seat_act_json(s: &Inner, a: &crate::inner::SeatAct) -> Value {
    let (status, end) = s.seat_act_status(a);
    Obj::new()
        .set("ord", a.ord)
        .set("seq", a.seq)
        .set("t", a.t)
        .set("participant", a.participant.clone())
        .set("as", a.as_.clone())
        .opt("draft", a.draft.clone())
        .opt("via", a.via.clone())
        .set("action", a.action)
        .opt("status", Some(status))
        .opt("endT", end)
        .set("kinds", a.kinds.clone())
        .set("text", a.text.clone())
        .set("from", a.from)
        .set(
            "targets",
            a.targets
                .iter()
                .map(|t| Obj::new().set("id", t.id.clone()).set("kind", t.kind).set("struct", t.st).build())
                .collect::<Vec<_>>(),
        )
        .build()
}

/// A seat's act as the pilot viewer has it (its words, the translator's draft, the sign-off, the outcome) beside its
/// sitting, its twin, where it landed, and the trace of what it rested on.
pub fn seat_act_panel(s: &Inner, pilot: Option<&Value>, ord: u32) -> Option<Value> {
    let a = s.seat_acts.iter().find(|x| x.ord == ord)?;
    let seat = pilot.and_then(|p| p.get("seats")).and_then(|ss| arr(Some(ss)).iter().find(|x| gs(x, "id") == Some(a.participant.as_str())));
    let (mut request, mut sitting, mut direct): (Option<Value>, Option<Value>, Option<Value>) = (None, None, None);
    if let Some(seat) = seat {
        for sit in arr(seat.get("sittings")) {
            let r = arr(sit.get("requests")).iter().find(|q| {
                q.get("act").map(|ac| num_eq(ac.get("seq"), a.seq)).unwrap_or(false)
                    || (a.draft.as_ref().map(|d| !d.is_empty()).unwrap_or(false) && gs(q, "id") == a.draft.as_deref())
            });
            let d = arr(sit.get("direct")).iter().find(|q| num_eq(q.get("seq"), a.seq));
            if r.is_some() || d.is_some() {
                request = r.cloned();
                direct = d.cloned();
                let turns: Vec<Value> = arr(sit.get("turns"))
                    .iter()
                    .map(|tu| {
                        let tools: Vec<Value> = arr(tu.get("tools")).iter().map(|x| pick(x, &["name", "input"])).collect();
                        let mut o = pick(tu, &["turn", "say"]);
                        o.as_object_mut().unwrap().insert("tools".into(), tools.into());
                        o
                    })
                    .collect();
                let mut o = pick(sit, &["t", "day", "stamp", "model"]);
                let m = o.as_object_mut().unwrap();
                m.insert("reading".into(), take_chars(&jstr0(sit.get("reading")), 6000).into());
                if let Some(x) = sit.get("readingLen") {
                    m.insert("readingLen".into(), x.clone());
                }
                m.insert("turns".into(), turns.into());
                if let Some(x) = sit.get("cost") {
                    m.insert("cost".into(), x.clone());
                }
                sitting = Some(o);
                break;
            }
        }
    }
    let twin_seat = pilot
        .and_then(|p| p.get("twin"))
        .and_then(|t| t.get("seats"))
        .and_then(|ss| arr(Some(ss)).iter().find(|x| gs(x, "seat") == Some(a.participant.as_str())));
    let pair = twin_seat
        .and_then(|ts| arr(ts.get("pairs")).iter().find(|p| p.get("seat").map(|sx| num_eq(sx.get("seq"), a.seq)).unwrap_or(false)));
    let e = s.line(ord).unwrap_or(Value::Null);
    let b = e.get("body").cloned().unwrap_or(Value::Null);
    let mut act = seat_act_json(s, a);
    {
        let m = act.as_object_mut().unwrap();
        m.insert("sentence".into(), describe(s, &e).into());
        for k in ["reasoning", "provenance", "blocks"] {
            if let Some(x) = b.get(k) {
                m.insert(k.into(), x.clone());
            }
        }
    }
    let run_id = s.world().run_id.clone();
    let twin = match (pair, twin_seat) {
        (Some(p), _) => Obj::new()
            .opt("same", p.get("same").cloned())
            .set("act", p.get("twin").cloned().unwrap_or(Value::Null))
            .set("run", run_id)
            .build(),
        (None, Some(_)) => Obj::new()
            .set("same", false)
            .set("act", Value::Null)
            .set("note", "no matching act of the code twin on the same parties and matter")
            .build(),
        (None, None) => Value::Null,
    };
    let seat_v = match seat {
        Some(sx) => pick(sx, &["id", "title", "model", "framing"]),
        None => Obj::new()
            .set("id", a.participant.clone())
            .opt("model", s.participant_info(&a.participant).and_then(|i| i.model.clone()))
            .build(),
    };
    let links: Vec<Value> = trace(s, ord, None, 8).iter().map(|l| serde_json::to_value(l).unwrap()).collect();
    Some(
        Obj::new()
            .set("act", act)
            .set("seat", seat_v)
            .opt("request", request)
            .opt("direct", direct)
            .opt("sitting", sitting)
            .set("twin", twin)
            .set("trace", links)
            .build(),
    )
}

/// Counts of consequential changes by day, by the class of who decided (the pulses), and the hard ones.
pub fn town_pulse(s: &Inner) -> Value {
    let d = s.days() + 1;
    let mut by_class: Vec<Vec<i64>> = CLASSES.iter().map(|_| vec![0; d]).collect();
    let mut hard = vec![0i64; d];
    for k in s.pulses.chunks_exact(6) {
        let day = (floor_div(k[0] as i64, DAY).max(0) as usize).min(d - 1);
        by_class[(k[3] as usize).min(4)][day] += 1;
        if k[4] & 1 != 0 {
            hard[day] += 1;
        }
    }
    Obj::new()
        .set(
            "byClass",
            Value::Object(
                CLASSES.iter().enumerate().map(|(i, c)| (class_name(*c).to_string(), Value::from(by_class[i].clone()))).collect(),
            ),
        )
        .set("hard", hard)
        .build()
}

/// The `/seat/<id>` payload from the pilot's data.
pub fn seat_json(pilot: Option<&Value>, id: &str) -> Value {
    let seat = pilot.and_then(|p| p.get("seats")).and_then(|ss| arr(Some(ss)).iter().find(|x| gs(x, "id") == Some(id)));
    let Some(seat) = seat else { return serde_json::json!({"missing": true}) };
    let mut o = pick(seat, &["id", "title", "model", "framing", "calls", "cost", "acts", "requests", "confirmed", "declined", "notebook"]);
    let sittings: Vec<Value> = arr(seat.get("sittings"))
        .iter()
        .map(|x| {
            let mut v = pick(x, &["day", "stamp", "t", "calls", "cost"]);
            let m = v.as_object_mut().unwrap();
            m.insert("requests".into(), arr(x.get("requests")).len().into());
            m.insert("direct".into(), arr(x.get("direct")).len().into());
            let say: Vec<String> =
                arr(x.get("turns")).iter().filter_map(|tu| g(tu, "say").filter(|s| truthy(Some(s))).map(|s| jstr(Some(s)))).collect();
            m.insert("say".into(), take_chars(&say.join("\n\n"), 1200).into());
            v
        })
        .collect();
    o.as_object_mut().unwrap().insert("sittings".into(), sittings.into());
    o
}

/// The pilot summary the `/world` route carries (`pilot` of server.ts).
pub fn pilot_summary(pilot: Option<&Value>) -> Value {
    let Some(p) = pilot else { return Value::Null };
    let seats: Vec<Value> = arr(p.get("seats"))
        .iter()
        .map(|x| {
            let mut v = pick(x, &["id", "title", "model", "framing", "calls", "cost", "acts", "requests", "confirmed", "declined"]);
            let sittings = match x.get("sittings") {
                Some(Value::Array(a)) => Some(Value::from(a.len())),
                Some(o) => Some(o.clone()),
                None => None,
            };
            if let Some(sv) = sittings {
                v.as_object_mut().unwrap().insert("sittings".into(), sv);
            }
            v
        })
        .collect();
    let twin = match p.get("twin") {
        Some(t) if truthy(Some(t)) => {
            let seats: Vec<Value> = arr(t.get("seats"))
                .iter()
                .map(|x| pick(x, &["seat", "seatActs", "twinActs", "matched", "same", "differ", "seatOnly", "twinOnly"]))
                .collect();
            Obj::new().opt("run", t.get("run").cloned()).set("seats", seats).build()
        }
        _ => Value::Null,
    };
    let town = match p.get("town") {
        Some(t) if truthy(Some(t)) => pick(t, &["series", "twinSeries"]),
        _ => Value::Null,
    };
    Obj::new().opt("overview", p.get("overview").cloned()).set("seats", seats).set("twin", twin).set("town", town).build()
}
