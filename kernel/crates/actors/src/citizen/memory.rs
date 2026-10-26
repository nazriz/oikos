//! What a person keeps of public goings-on (risk SC-1; docs/behaviour/citizen.md, "What a person remembers of
//! public goings-on").
//!
//! A person reads what is published as it comes (the paper, notices of gatherings, what groups teach, petitions'
//! counts, a body's word that it hears grievances, what joining a group asks, an election's papers) and keeps, of
//! all that, a bounded slice: whatever touched them (it is theirs, it was addressed to them, it speaks for someone they
//! have dealings with, it answers a paper of theirs, or their mind holds to it: a gathering they go to), and of the
//! rest the `most` most recent of each kind that they saw in the last `days` or that still stands (of those put out at
//! the same moment, a fixed spread of the person and the paper says which). The rest is let
//! go, as if never seen (`Book::forget`), and what their mind kept about it with it (`Mind::forgot`). A paper is read
//! when it comes, and let go at the earliest at the next going-through, so every paper is read before it can go.
//!
//! Why: people attend to and remember a bounded, recent and relevant slice of public news (limited attention:
//! Simon 1971; forgetting: Ebbinghaus 1885; the news people follow: a few local stories at a time. All "(to
//! confirm)", docs/research/references.md). Before this, each person kept and weighed every published paper and
//! gathering for good, so a town's memory grew as people times papers (2.8 GB a simulated day at 50,000 people).
//!
//! What it never lets go: anything that is not a public statement of the kinds named (the law, a form, an
//! agreement, a claim, a letter); a withdrawal of a paper it keeps. The bound is the world's (`public_memory`, the
//! generator's placeholder), absent: nothing is let go, as before. Deterministic: in the order seen, at a fixed
//! cadence from the person's own wakes.

use super::person::Person;
use crate::common::{addressed_to, bases_of, Book, DAY};
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The world's bound on what a person keeps of public goings-on (the citizen's `public_memory` parameter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublicMemory {
    /// Kinds of public statement that are goings-on (`news`, `petition_count`...).
    #[serde(default)]
    pub kinds: Vec<String>,
    /// Statements having one of these (`practice`, `assertion`, `hears`) are goings-on too, of the class `has:<it>`.
    #[serde(default)]
    pub has: Vec<String>,
    /// What was put out in so many days may be kept though it no longer stands (a withdrawn notice); older, only
    /// what still stands.
    pub days: i64,
    /// Of what touches them in none of the ways above, so many of each class at most (the most recent).
    pub most: usize,
    /// How often it is gone through, in days (default 7: a week).
    #[serde(default = "week")]
    pub every_days: i64,
}

fn week() -> i64 {
    7
}

impl PublicMemory {
    /// The class a record is of, if it is one of public goings-on (a public statement of a kind named, or having a
    /// part named).
    pub fn class_of(&self, r: &Record) -> Option<String> {
        let RecordBody::Statement { kind, practice, assertion, offer, .. } = &r.body else { return None };
        if !matches!(r.visible_to, oikos_contracts::blocks::Visibility::Public(_)) {
            return None;
        }
        if self.kinds.iter().any(|k| k == kind) {
            return Some(kind.clone());
        }
        for h in &self.has {
            let has = match h.as_str() {
                "practice" => practice.is_some(),
                "assertion" => assertion.is_some(),
                "hears" => offer.as_ref().and_then(|o| o.get("hears")).is_some_and(|x| !x.is_null() && x != &serde_json::Value::Bool(false)),
                _ => false,
            };
            if has {
                return Some(format!("has:{h}"));
            }
        }
        None
    }

    /// What of the book is kept at `t`, by `me` (an entity; `participant`: its own author id), given the ids the
    /// mind holds to: true for every record kept.
    pub fn keeps(&self, book: &Book, me: &str, participant: &str, held: &BTreeSet<String>, t: i64) -> BTreeSet<String> {
        let horizon = t - self.days * DAY;
        // Whom we have dealings with: the other parties to agreements of ours in force (an employer, a landlord, a
        // group we joined, the union).
        let dealings: BTreeSet<&str> = book
            .of_type("agreement")
            .filter_map(|a| match &a.body {
                RecordBody::Agreement { terms } if terms.parties.iter().any(|p| p.as_str() == me) && book.in_force(&a.id) => Some(terms.parties.iter().map(|p| p.as_str())),
                _ => None,
            })
            .flatten()
            .filter(|p| *p != me)
            .collect();
        let ours = |r: &Record| r.speaks_for.as_deref() == Some(me) || r.author == participant;
        let mine: BTreeSet<&str> = book.records().filter(|r| ours(r)).map(|r| r.id.as_str()).collect();
        let mut keep: BTreeSet<String> = BTreeSet::new();
        let mut older: BTreeMap<String, Vec<(i64, u64, &str)>> = BTreeMap::new();
        for r in book.records() {
            let Some(class) = self.class_of(r) else {
                if !matches!(r.body, RecordBody::Withdrawal { .. }) || r.at >= horizon {
                    keep.insert(r.id.to_string());
                }
                continue;
            };
            let touches = ours(r)
                || addressed_to(r).iter().any(|a| a == me)
                || held.contains(r.id.as_str())
                || r.speaks_for.as_deref().is_some_and(|s| dealings.contains(s))
                || bases_of(r).iter().any(|b| mine.contains(b.as_str()));
            if touches {
                keep.insert(r.id.to_string());
            } else if r.at >= horizon || !book.withdrawn(&r.id) {
                older.entry(class).or_default().push((r.at, spread(me, &r.id), r.id.as_str()));
            }
        }
        for (_, mut v) in older {
            v.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(b.2)));
            keep.extend(v.into_iter().take(self.most).map(|x| x.2.to_string()));
        }
        keep
    }
}

/// Of papers put out at the same moment (a town's gatherings, all noticed at the start), which a person happens to have
/// in mind: a fixed spread of the person and the paper (FNV-1a), so that people do not all keep the same few, and no draw
/// of the world's randomness is spent on it.
fn spread(me: &str, id: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in me.bytes().chain([0u8]).chain(id.bytes()) {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

impl Person {
    /// Goes through what is kept of public goings-on, at the world's cadence (`public_memory`; absent: never).
    pub fn remember(&mut self, t: i64, participant: &str) {
        let Some(m) = self.p.public_memory.clone() else { return };
        let due = self.s.memory_at.is_none_or(|at| t - at >= m.every_days.max(1) * DAY);
        if !due {
            return;
        }
        self.s.memory_at = Some(t);
        let held: BTreeSet<String> = self.mind.holds_to().into_iter().collect();
        let keep = m.keeps(&self.book, &self.me, participant, &held, t);
        if keep.len() == self.book.len() {
            return;
        }
        let remap = self.book.forget(|r| keep.contains(r.id.as_str()));
        // (Whoever keeps a place in the book: the housing part's last full plan.)
        let moved = |at: usize| remap.iter().take(at).filter(|x| x.is_some()).count();
        self.housing.fresh_from = moved(self.housing.fresh_from.min(remap.len()));
        self.housing.fresh_to = moved(self.housing.fresh_to.min(remap.len()));
        self.mind.forgot(&self.book);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ctx, WorldInfo};
    use oikos_sight::Record;
    use serde_json::{json, Value};
    use std::sync::Arc;

    const ME: &str = "c1";

    fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }
    fn public(id: &str, at: i64, kind: &str, by: &str, more: Value) -> Arc<Record> {
        let mut v = json!({ "id": id, "record": "statement", "author": format!("{by}-office"), "speaks_for": by, "at": at, "visible_to": "public", "kind": kind, "text": kind });
        if let (Some(o), Some(m)) = (v.as_object_mut(), more.as_object()) {
            o.extend(m.clone());
        }
        rec(v)
    }
    fn person(memory: Value) -> Person {
        let mut params = json!({ "mind": "plain", "bank": "bank", "public_memory": memory });
        if memory.is_null() {
            params.as_object_mut().unwrap().remove("public_memory");
        }
        let c = Ctx { participant: "c1-self".into(), performer: Default::default(), entity: ME.into(), position: None, params: serde_json::from_value(params).unwrap(), world: Arc::new(WorldInfo::default()) };
        Person::new(&c).unwrap()
    }
    fn bound() -> Value {
        json!({ "kinds": ["news"], "has": ["practice"], "days": 30, "most": 2 })
    }

    #[test]
    fn a_person_keeps_a_month_of_the_news_what_touched_them_and_the_most_recent_few_still_standing_and_lets_go_of_the_rest() {
        let mut p = person(bound());
        let mut recs = vec![public("law-1", 0, "law", "city", json!({}))];
        for d in 0..100 {
            recs.push(public(&format!("news-{d}"), d * DAY, "news", "paper", json!({})));
        }
        recs.push(public("news-me", 3 * DAY, "news", "paper", json!({ "addressed_to": [ME] })));
        recs.push(public("news-about-mine", 4 * DAY, "news", "paper", json!({ "basis": "mine-1" })));
        recs.push(rec(json!({ "id": "mine-1", "record": "statement", "author": "c1-self", "speaks_for": ME, "at": DAY, "visible_to": "public", "kind": "petition", "text": "x" })));
        for g in 0..5 {
            recs.push(public(&format!("gathering-{g}"), g * DAY, "notice", &format!("group-{g}"), json!({ "practice": { "every": 604800 } })));
        }
        recs.push(rec(json!({ "id": "w-4", "record": "withdrawal", "author": "group-4-office", "at": 5 * DAY, "visible_to": "public", "withdraws": "gathering-4" })));
        p.book.take_all(&recs);
        p.housing.fresh_from = p.book.len();
        p.remember(100 * DAY, "c1-self");
        let has = |id: &str| p.book.has(id);
        assert!(has("law-1") && has("mine-1"), "the law, and their own");
        assert!(has("news-me") && has("news-about-mine"), "what touched them");
        assert!(has("news-99") && has("news-98") && !has("news-97") && !has("news-0"), "of the rest, the two most recent");
        assert!(!has("gathering-4") && !has("w-4"), "withdrawn long since, with its withdrawal");
        assert!(has("gathering-3") && has("gathering-2") && !has("gathering-1"), "of each kind, of what stands");
        assert_eq!(p.housing.fresh_from, p.book.len(), "a place kept in the book is moved with what is kept");
        // Not again before a week; and with no bound, nothing is let go.
        let n = p.book.len();
        p.book.take_all(&[public("news-200", 0, "news", "paper", json!({}))]);
        p.remember(101 * DAY, "c1-self");
        assert_eq!(p.book.len(), n + 1);
        let mut q = person(Value::Null);
        q.book.take_all(&recs);
        q.remember(100 * DAY, "c1-self");
        assert_eq!(q.book.len(), recs.len());
    }

    #[test]
    fn of_gatherings_all_noticed_at_once_people_keep_different_few_and_the_same_person_the_same() {
        let recs: Vec<Arc<Record>> = (0..12).map(|g| public(&format!("gathering-{g}"), 0, "notice", &format!("group-{g}"), json!({ "practice": { "every": 604800 } }))).collect();
        let kept = |me: &str| {
            let m: PublicMemory = serde_json::from_value(json!({ "has": ["practice"], "days": 30, "most": 3 })).unwrap();
            let mut b = Book::new();
            b.take_all(&recs);
            m.keeps(&b, me, &format!("{me}-self"), &BTreeSet::new(), 100 * DAY)
        };
        assert_eq!(kept("c1").len(), 3);
        assert_eq!(kept("c1"), kept("c1"));
        let all: BTreeSet<String> = ["c1", "c2", "c3", "c4", "c5"].iter().flat_map(|p| kept(p)).collect();
        assert!(all.len() > 6, "spread across people: {all:?}");
    }
}
