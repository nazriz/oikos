//! Asking whoever keeps it (docs/no-god-view.md; common.ts `ask`, `lookUp`, `goSee`, `visited`, `ownerLooks`,
//! `whoWrote`, `Asked`). Nobody has a god's view: anything a participant needs that is not its own, not where it is,
//! and not published, it asks for from whoever keeps it, one thing at a time. These build the look requests; return
//! them from a plan's `looks` or as `Action::Look`. The answer comes with the next observation, into the same book.

use super::book::{Book, ClaimKey};
use oikos_sight::{CmpOp, Condition, Going, LookRequest, Order, Picture, Query, Seen, SiteCell, Who};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// How many places one visit goes to at most (the contract's).
pub const VISIT_MAX: usize = 16;
/// How many look-ups one look carries at most (the contract's: a look names up to 16 channels).
pub const LOOKS_MAX: usize = 16;

fn eq(field: &str, value: impl Into<Value>) -> Condition {
    Condition { field: field.to_string(), op: CmpOp::Eq, value: value.into() }
}

/// Searches of a channel shown on request (contracts: LookRequest with a query).
pub mod ask {
    use super::*;

    /// The one record with this id: a lot's plan, a title, a listing someone gave us the number of.
    pub fn one(channel: &str, id: &str) -> LookRequest {
        LookRequest {
            channel: channel.into(),
            query: Some(Query { standing: None, conditions: Some(vec![eq("id", id)]), order: None, limit: Some(1) }),
            who: None,
            visit: None,
        }
    }

    /// How `about` orders and cuts what it finds.
    #[derive(Debug, Clone, Copy, Default)]
    pub struct About {
        /// At most this many (how many a person would read: from the module's parameters).
        pub most: u32,
        /// Made at or after then.
        pub since: Option<i64>,
        /// Only those not withdrawn.
        pub standing: bool,
        /// The latest first (so `most: 1` is the current one).
        pub newest: bool,
        /// In the order made.
        pub oldest: bool,
    }

    /// The records that say `value` at `field` (`speaks_for`: one shop's price list; `claim`: the dealings in one
    /// title; `data.employer`: the agreements at one workplace; `about.object`: the titles to one lot).
    pub fn about(channel: &str, field: &str, value: impl Into<Value>, o: About) -> LookRequest {
        let mut w = vec![eq(field, value)];
        if let Some(s) = o.since {
            w.push(Condition { field: "at".into(), op: CmpOp::Ge, value: s.into() });
        }
        let order = if o.newest {
            Some(Order { field: "at".into(), desc: true })
        } else if o.oldest {
            Some(Order { field: "at".into(), desc: false })
        } else {
            None
        };
        LookRequest {
            channel: channel.into(),
            query: Some(Query { standing: o.standing.then_some(true), conditions: Some(w), order, limit: Some(o.most) }),
            who: None,
            visit: None,
        }
    }

    /// A reader's few: the first `most` standing records of a board (a listings page), by `by` if given (`desc`:
    /// dearest first), under conditions the reader sets. Never a way round the rule: `most` is how many a person
    /// would read, from the module's parameters.
    pub fn board(channel: &str, most: u32, conditions: Vec<Condition>, by: Option<(&str, bool)>) -> LookRequest {
        LookRequest {
            channel: channel.into(),
            query: Some(Query {
                standing: Some(true),
                conditions: (!conditions.is_empty()).then_some(conditions),
                order: by.map(|(f, desc)| Order { field: f.into(), desc }),
                limit: Some(most),
            }),
            who: None,
            visit: None,
        }
    }
}

/// Who's who, looked up one at a time (docs/design/knowing.md, section 7): nobody is shown the directory.
pub mod look_up {
    use super::*;
    fn who(channel: &str, w: Who) -> LookRequest {
        LookRequest { channel: channel.into(), query: None, who: Some(w), visit: None }
    }
    const NOBODY: Who = Who { entity: None, participant: None, position: None, name: None, role: None };
    pub fn entity(channel: &str, entity: &str) -> LookRequest {
        who(channel, Who { entity: Some(entity.into()), ..NOBODY })
    }
    pub fn participant(channel: &str, participant: &str) -> LookRequest {
        who(channel, Who { participant: Some(participant.into()), ..NOBODY })
    }
    pub fn position(channel: &str, position: &str) -> LookRequest {
        who(channel, Who { position: Some(position.into()), ..NOBODY })
    }
    pub fn name(channel: &str, name: &str) -> LookRequest {
        who(channel, Who { name: Some(name.into()), ..NOBODY })
    }
    /// An organisation's positions of one role (the councillors of the town).
    pub fn holders(channel: &str, entity: &str, role: &str) -> LookRequest {
        who(channel, Who { entity: Some(entity.into()), role: Some(role.into()), ..NOBODY })
    }
}

/// Going to look (docs/design/knowing.md, section 8): at most `VISIT_MAX` places in one going; it takes the looker's
/// time, and what was there comes when it ends, through the same channel (`visited`).
pub fn go_see(channel: &str, places: &[String]) -> LookRequest {
    LookRequest {
        channel: channel.into(),
        query: None,
        who: None,
        visit: Some(Going { places: places.iter().take(VISIT_MAX).cloned().collect() }),
    }
}

/// The cells a visit just found (this observation brought them), as they were when the looker was there.
pub fn visited<'a>(pic: &'a Picture, channel: &str) -> Vec<&'a SiteCell> {
    match pic.channels.get(channel) {
        Some(Seen::Sites { cells, visit: Some(v), .. }) if !v.fresh.is_empty() => {
            let fresh: BTreeSet<&str> = v.fresh.iter().map(String::as_str).collect();
            cells.iter().filter(|c| fresh.contains(c.cell.as_str())).collect()
        }
        _ => vec![],
    }
}

/// What has been asked for already, so that it is asked once; with a time, again once something newer calls for it
/// (common.ts `Asked`). Saved with the actor.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Asked {
    when: BTreeMap<String, i64>,
}

impl Asked {
    /// True the first time only (and remembers it as asked at `t`).
    pub fn first(&mut self, key: &str, t: i64) -> bool {
        if self.when.contains_key(key) {
            return false;
        }
        self.when.insert(key.to_string(), t);
        true
    }
    /// When this was last asked (never: -1, before any time).
    pub fn since(&self, key: &str) -> i64 {
        self.when.get(key).copied().unwrap_or(-1)
    }
    pub fn again(&mut self, key: &str, t: i64) {
        self.when.insert(key.to_string(), t);
    }
}

/// The land register's two channels: its titles and the dealings in them.
#[derive(Debug, Clone)]
pub struct Register<'a> {
    pub titles: &'a str,
    pub dealings: &'a str,
}

/// What to ask the land register next so as to know who owns a lot: the titles to it, then the dealings in each (each
/// asked once). At most one search for each of the register's channels, and none for a channel in `used` (what this
/// look asks already). Return them from a plan's `looks`, which asks again until there is nothing more to ask.
pub fn owner_looks(book: &Book, asked: &mut Asked, register: &Register, lot: &str, used: &mut BTreeSet<String>, most: u32) -> Vec<LookRequest> {
    let tk = format!("titles:{lot}");
    if asked.since(&tk) < 0 {
        if used.contains(register.titles) {
            return vec![];
        }
        used.insert(register.titles.to_string());
        asked.first(&tk, 0);
        return vec![ask::about(register.titles, "about.object", lot, ask::About { most, ..Default::default() })];
    }
    for c in book.claims_by(ClaimKey::Object, lot) {
        let ownership = match &c.body {
            oikos_sight::RecordBody::Claim { about, .. } => about.get("kind").and_then(Value::as_str) == Some("ownership"),
            _ => false,
        };
        let dk = format!("dealings:{}", c.id);
        if !ownership || asked.since(&dk) >= 0 || used.contains(register.dealings) {
            continue;
        }
        used.insert(register.dealings.to_string());
        asked.first(&dk, 0);
        return vec![ask::about(register.dealings, "claim", c.id.as_str(), ask::About { most, oldest: true, ..Default::default() })];
    }
    vec![]
}

/// The look-ups that would say for whom each of these records was written, for those the book cannot say yet: each
/// asked once, at most a look's worth at a time. With no directory to look in, none (common.ts `whoWrote`).
pub fn who_wrote<'a>(book: &Book, asked: &mut Asked, channel: Option<&str>, records: impl IntoIterator<Item = &'a oikos_sight::Record>) -> Vec<LookRequest> {
    let mut out = vec![];
    let Some(channel) = channel.filter(|c| !c.is_empty()) else { return out };
    for r in records {
        if out.len() >= LOOKS_MAX {
            break;
        }
        if r.author == oikos_contracts::blocks::GENESIS {
            continue;
        }
        match &r.position {
            Some(p) => {
                if book.position(p).is_none() && asked.first(&format!("position:{p}"), 0) {
                    out.push(look_up::position(channel, p));
                }
            }
            None => {
                if book.person_of(&r.author).is_none() && asked.first(&format!("participant:{}", r.author), 0) {
                    out.push(look_up::participant(channel, &r.author));
                }
            }
        }
    }
    out
}
