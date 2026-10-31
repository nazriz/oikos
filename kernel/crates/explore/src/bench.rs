//! The researcher workbench's queries (docs/explorer.md, "The workbench"): a run's events as a filterable table, groups
//! of people defined by a filter and followed over time against the rest of the town, and per-building counts for
//! comparing runs on the map. Aggregated and paginated here, so a browser never holds a year of a 10,000-person town.
//! Read-only, like the rest of the crate; nothing here judges an outcome: counts, means and shares, named.
//!
//! Cheap filters (kind, who, class, office, days, outcome) read only the in-memory line metadata; the text filter and
//! each row shown decompress their lines, so a text search stops after `TEXT_SCAN` lines and says it is partial.

use crate::inner::{Inner, DAY, PULSE_INTS};
use crate::js::Obj;
use crate::world::{class_code, class_name, CLASS_NAMES};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

/// The most lines a text filter decompresses and reads before it answers with what it found.
pub const TEXT_SCAN: usize = 400_000;

/// A filter of the events table. Every field narrows; an empty one does not.
#[derive(Debug, Clone, Default)]
pub struct EventQuery {
    /// Exact line names (`act`, `transfer`, `recorded`, `annotation:decision`...).
    pub kinds: Vec<String>,
    /// Who decided or acted: a participant id (a person's id matches their own participant too).
    pub who: Option<String>,
    /// Their class: self, person, system, seat, world.
    pub cls: Option<String>,
    /// An organisation: lines by whoever holds one of its posts.
    pub office: Option<String>,
    /// Lines naming this id (a person, an organisation, a record, an account).
    pub about: Option<String>,
    pub from_day: Option<i64>,
    pub to_day: Option<i64>,
    /// The outcome of the act behind the line: applied, refused, pending, or none (no act).
    pub outcome: Option<String>,
    /// Words in the line's sentence (case-insensitive).
    pub text: Option<String>,
    pub offset: usize,
    pub limit: usize,
    /// Newest first.
    pub desc: bool,
}

fn status_name(code: i32) -> &'static str {
    ["pending", "applied", "refused"].get(code as usize).copied().unwrap_or("?")
}

/// The participants who hold a post of an organisation (the world's posts, as the header gives them).
fn holders_of(s: &Inner, org: &str) -> HashSet<i32> {
    let w = s.world();
    w.posts
        .iter()
        .filter(|p| p.entity.as_deref() == Some(org) || p.id == org)
        .filter_map(|p| p.holder.as_deref())
        .filter_map(|h| s.part_idx.get(h).map(|&i| i as i32))
        .collect()
}

/// The events table: rows of the page, the total that pass, and counts by kind and by class of who decided.
#[allow(clippy::explicit_counter_loop)]
pub fn events(s: &Inner, q: &EventQuery) -> Value {
    let n = s.kept();
    let lo = q.from_day.map(|d| s.metas.partition_point(|m| (m.t as i64) < d * DAY)).unwrap_or(0);
    let hi = q.to_day.map(|d| s.metas.partition_point(|m| (m.t as i64) < (d + 1) * DAY)).unwrap_or(n);
    let kinds: HashSet<u32> = q.kinds.iter().filter_map(|k| s.names.iter().position(|x| x == k).map(|i| i as u32)).collect();
    let no_kind = !q.kinds.is_empty() && kinds.is_empty();
    let who: Option<HashSet<i32>> =
        q.who.as_ref().map(|w| [w.clone(), format!("{w}-self")].iter().filter_map(|id| s.part_idx.get(id).map(|&i| i as i32)).collect());
    let office = q.office.as_ref().map(|o| holders_of(s, o));
    let cls = q.cls.as_ref().and_then(|c| CLASS_NAMES.iter().position(|x| x == c));
    let about: Option<Vec<u32>> = q.about.as_ref().map(|a| {
        let mut ids = vec![a.clone(), format!("{a}-self")];
        ids.dedup();
        s.postings_of(&ids)
    });
    let pass = |o: usize| -> bool {
        let m = &s.metas[o];
        if no_kind || (!kinds.is_empty() && !kinds.contains(&m.name)) {
            return false;
        }
        if let Some(w) = &who {
            if !w.contains(&m.who) {
                return false;
            }
        }
        if let Some(of) = &office {
            if !of.contains(&m.who) {
                return false;
            }
        }
        if let Some(c) = cls {
            let got = if m.who < 0 { 4 } else { class_code(s.part_cls.get(m.who as usize).copied().unwrap_or(crate::Decider::World)) };
            if got != c {
                return false;
            }
        }
        if let Some(out) = &q.outcome {
            let st = if m.action >= 0 { s.actions.get(m.action as usize).map(|a| status_name(a[2])) } else { None };
            match (out.as_str(), st) {
                ("none", None) => {}
                (want, Some(got)) if want == got => {}
                _ => return false,
            }
        }
        true
    };
    // the candidates, in order
    let cand: Vec<u32> = match &about {
        Some(p) => p.iter().copied().filter(|&o| (o as usize) >= lo && (o as usize) < hi && pass(o as usize)).collect(),
        None => (lo..hi).filter(|&o| pass(o)).map(|o| o as u32).collect(),
    };
    // facets over what the cheap filters let through
    let mut by_kind: HashMap<u32, usize> = HashMap::new();
    let mut by_cls = [0usize; 5];
    for &o in &cand {
        let m = &s.metas[o as usize];
        *by_kind.entry(m.name).or_default() += 1;
        let c = if m.who < 0 { 4 } else { class_code(s.part_cls.get(m.who as usize).copied().unwrap_or(crate::Decider::World)) };
        by_cls[c] += 1;
    }
    let mut kinds_out: Vec<(String, usize)> = by_kind.into_iter().map(|(k, c)| (s.names[k as usize].clone(), c)).collect();
    kinds_out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let order: Box<dyn Iterator<Item = u32>> = if q.desc { Box::new(cand.iter().rev().copied()) } else { Box::new(cand.iter().copied()) };
    let limit = q.limit.clamp(1, 100_000);
    let mut rows = vec![];
    let (total, exact) = match q.text.as_deref().map(str::to_lowercase).filter(|t| !t.trim().is_empty()) {
        None => {
            for o in order.skip(q.offset).take(limit) {
                rows.push(row(s, o));
            }
            (cand.len(), true)
        }
        Some(words) => {
            let words: Vec<&str> = words.split_whitespace().collect();
            let mut seen = 0;
            let mut matched = 0;
            let mut exact = true;
            for o in order {
                if seen >= TEXT_SCAN {
                    exact = false;
                    break;
                }
                seen += 1;
                let r = crate::trace::event_row(s, o, None);
                let t = r.text.to_lowercase();
                if words.iter().all(|w| t.contains(w) || r.name.contains(w)) {
                    if matched >= q.offset && rows.len() < limit {
                        rows.push(row_of(s, o, r));
                    }
                    matched += 1;
                }
            }
            (matched, exact)
        }
    };
    Obj::new()
        .set("total", total)
        .set("exact", exact)
        .set("offset", q.offset)
        .set("rows", rows)
        .set("kinds", kinds_out.iter().take(60).map(|(k, c)| Value::Array(vec![k.clone().into(), (*c).into()])).collect::<Vec<_>>())
        .set(
            "classes",
            Obj::new()
                .set("self", by_cls[0])
                .set("person", by_cls[1])
                .set("system", by_cls[2])
                .set("seat", by_cls[3])
                .set("world", by_cls[4])
                .build(),
        )
        .build()
}

fn row(s: &Inner, o: u32) -> Value {
    row_of(s, o, crate::trace::event_row(s, o, None))
}

fn row_of(s: &Inner, o: u32, r: crate::trace::EventRow) -> Value {
    let m = &s.metas[o as usize];
    let act = if m.action >= 0 { s.actions.get(m.action as usize) } else { None };
    Obj::new()
        .set("ord", o)
        .set("t", r.t)
        .set("day", r.day)
        .set("kind", r.name)
        .opt("who", r.who)
        .set("cls", class_name(r.cls))
        .opt("outcome", act.map(|a| status_name(a[2])))
        .set("text", r.text)
        .build()
}

/// Who is in a group, by a rule over what reached them.
#[derive(Debug, Clone)]
pub enum CohortRule {
    /// Reached by a consequential change: of a class of who decided (or any), landing hard only, and whose line's
    /// record kind or sentence holds a word ("benefit_decision", "arrears", "refused").
    Reached { cls: Option<String>, hard: bool, word: Option<String> },
    /// Their own record's sense of agency below a value (0..10,000) at midnight of a day.
    AgencyBelow { bps: i64, day: i64 },
    /// Money in their accounts at most a sum (the world's smallest unit) at midnight of a day.
    MoneyAtMost { minor: i64, day: i64 },
}

#[derive(Debug, Clone)]
pub struct CohortQuery {
    pub rule: CohortRule,
    pub from_day: Option<i64>,
    pub to_day: Option<i64>,
    pub offset: usize,
    pub limit: usize,
}

/// A group, and its outcomes by day beside the rest of the town's: sense of agency (mean of those with a record),
/// money held (mean, the world's smallest unit), at home at midnight (share; a dwelling space), hard changes reaching
/// them (per 100 people a day). "In" is from the day each joined: before it a member counts with the rest.
#[allow(clippy::needless_range_loop)]
pub fn cohort(s: &Inner, q: &CohortQuery) -> Value {
    let tr = s.tracks();
    let (p, days) = (tr.persons, tr.days);
    let lo = q.from_day.unwrap_or(0).max(0);
    let hi = q.to_day.unwrap_or(days as i64).min(days as i64);
    // when each person joined (None: not a member)
    let mut joined: Vec<Option<(i64, u32)>> = vec![None; p];
    let np = s.pulses.len() / PULSE_INTS;
    match &q.rule {
        CohortRule::Reached { cls, hard, word } => {
            let c = cls.as_ref().and_then(|c| CLASS_NAMES.iter().position(|x| x == c));
            let word = word.as_ref().map(|w| w.to_lowercase());
            for i in 0..np {
                let k = i * PULSE_INTS;
                let (t, pi, pc, flags, ord) =
                    (s.pulses[k] as i64, s.pulses[k + 1] as usize, s.pulses[k + 3] as usize, s.pulses[k + 4], s.pulses[k + 5] as u32);
                let d = t.div_euclid(DAY);
                if d < lo || d > hi || pi >= p || joined[pi].is_some() {
                    continue;
                }
                if c.map(|c| c != pc).unwrap_or(pc == 0) || (*hard && flags & 1 == 0) {
                    continue;
                }
                if let Some(w) = &word {
                    let line = s.text(ord).unwrap_or_default().to_lowercase();
                    if !line.contains(w.as_str()) {
                        continue;
                    }
                }
                joined[pi] = Some((t, ord));
            }
        }
        CohortRule::AgencyBelow { bps, day } => {
            let d = (*day).clamp(0, days as i64) as usize;
            for (pi, j) in joined.iter_mut().enumerate() {
                let v = tr.agency[d * p + pi];
                if v >= 0 && (v as i64) < *bps {
                    *j = Some((d as i64 * DAY, u32::MAX));
                }
            }
        }
        CohortRule::MoneyAtMost { minor, day } => {
            let d = (*day).clamp(0, days as i64) as usize;
            for (pi, j) in joined.iter_mut().enumerate() {
                let pos = tr.holder_pos.get(pi).copied().unwrap_or(pi);
                if tr.money[d * tr.holders + pos] <= *minor {
                    *j = Some((d as i64 * DAY, u32::MAX));
                }
            }
        }
    }
    let members: Vec<usize> = (0..p).filter(|&i| joined[i].is_some()).collect();
    // hard changes by person and day
    let mut hard_by: BTreeMap<(usize, usize), u32> = BTreeMap::new();
    for i in 0..np {
        let k = i * PULSE_INTS;
        if s.pulses[k + 4] & 1 != 0 {
            let d = ((s.pulses[k] as i64).div_euclid(DAY)).clamp(0, days as i64) as usize;
            *hard_by.entry((s.pulses[k + 1] as usize, d)).or_default() += 1;
        }
    }
    let mut hard_day = vec![[0u32; 2]; days + 1];
    for (&(pi, d), &c) in &hard_by {
        if pi < p {
            let inn = joined[pi].map(|j| j.0.div_euclid(DAY) <= d as i64).unwrap_or(false);
            hard_day[d][usize::from(!inn)] += c;
        }
    }
    let dwelling: Vec<bool> = s.spaces.iter().map(|x| x.kind == "dwelling").collect();
    let mut series: [Vec<[Option<f64>; 4]>; 2] = [vec![], vec![]];
    for d in 0..=days {
        // [sum agency, n agency, sum money, n, at home, n where, n people]
        let mut acc = [[0f64; 7]; 2];
        for pi in 0..p {
            let g = usize::from(!joined[pi].map(|j| j.0.div_euclid(DAY) <= d as i64).unwrap_or(false));
            let a = &mut acc[g];
            a[6] += 1.0;
            let v = tr.agency[d * p + pi];
            if v >= 0 {
                a[0] += v as f64;
                a[1] += 1.0;
            }
            let pos = tr.holder_pos.get(pi).copied().unwrap_or(pi);
            a[2] += tr.money[d * tr.holders + pos] as f64;
            a[3] += 1.0;
            let w = tr.where_[d * p + pi];
            if w > 0 {
                a[5] += 1.0;
                if dwelling.get(w as usize - 1).copied().unwrap_or(false) {
                    a[4] += 1.0;
                }
            }
        }
        for g in 0..2 {
            let a = &acc[g];
            let r = |x: f64, n: f64| (n > 0.0).then(|| (x / n * 100.0).round() / 100.0);
            series[g].push([
                r(a[0], a[1]),
                r(a[2], a[3]),
                r(a[4], a[6]).map(|v| (v * 10000.0).round() / 10000.0),
                r(hard_day[d][g] as f64 * 100.0, a[6]),
            ]);
        }
    }
    let out = |g: usize| {
        let col = |i: usize| series[g].iter().map(|x| x[i].map(Value::from).unwrap_or(Value::Null)).collect::<Vec<_>>();
        Obj::new()
            .set("agency_mean_bps", col(0))
            .set("money_mean_minor", col(1))
            .set("at_home_share", col(2))
            .set("hard_per_100", col(3))
            .build()
    };
    let page: Vec<Value> = members
        .iter()
        .skip(q.offset)
        .take(q.limit.clamp(1, 10_000))
        .map(|&pi| {
            let (t, ord) = joined[pi].unwrap();
            Obj::new().set("person", s.persons[pi].clone()).set("t", t).opt("ord", (ord != u32::MAX).then_some(ord)).build()
        })
        .collect();
    Obj::new()
        .set("members", members.len())
        .set("rest", p - members.len())
        .set("days", days)
        .set("page", page)
        .set("cohort", out(0))
        .set("comparison", out(1))
        .build()
}

/// Per building, the consequential changes reaching the people who live there, days `from..=to`, by the class of who
/// decided (self, person, system, seat, world): the who-decided overlay's counts for one moment, and what comparing two
/// runs of one town on the map reads.
pub fn by_building(s: &Inner, from: i64, to: i64) -> Vec<[u32; 5]> {
    let n = s.world().structures.len() + s.extra_structures.len();
    let mut out = vec![[0u32; 5]; n];
    for k in (0..s.pulses.len()).step_by(PULSE_INTS) {
        let d = (s.pulses[k] as i64).div_euclid(DAY);
        let (st, pc) = (s.pulses[k + 2], (s.pulses[k + 3] as usize).min(4));
        if d < from || d > to || st < 0 || st as usize >= n {
            continue;
        }
        out[st as usize][pc] += 1;
    }
    out
}
