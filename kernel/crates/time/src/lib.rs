//! World time's semantics (docs/design/rebuild.md section 6): acting costs time. Every act takes its actor time, by the
//! act's kind and the actor's kind (the world's `orchestration.act_time`); the actor is busy until it's done, and it
//! takes effect then. A person has one timeline, shared by every capacity they act in; a system carries out as many
//! acts at once as it has lanes.
//!
//! Pure functions: the kernel keeps the timelines in its state and applies acts when they're done.

use serde_json::Value;
use std::collections::BTreeMap;

/// With no `act_time` in the world, and for an act kind its table doesn't name: every act takes one second, close to
/// the instant acts of before (the first parity step, rebuild.md section 14).
pub const DEFAULT_ACT_SECONDS: i64 = 1;

/// Who's acting: a person (one timeline) or a system (lanes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    Person,
    System,
}

/// The world's table of act times (`orchestration.act_time`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActTimes {
    person: BTreeMap<String, i64>,
    system: BTreeMap<String, i64>,
    default: Option<i64>,
}

impl ActTimes {
    /// From the world config's `orchestration` (the contract checks its shape).
    pub fn from_orchestration(orchestration: &Value) -> Self {
        let t = &orchestration["act_time"];
        let table = |k: &str| t[k].as_object().map(|m| m.iter().filter_map(|(kind, s)| s.as_i64().map(|s| (kind.clone(), s))).collect()).unwrap_or_default();
        Self { person: table("person"), system: table("system"), default: t["default"].as_i64() }
    }

    /// How long one act of this kind takes this kind of actor.
    pub fn of(&self, actor: Actor, kind: &str) -> i64 {
        let table = match actor {
            Actor::Person => &self.person,
            Actor::System => &self.system,
        };
        table.get(kind).copied().or(self.default).unwrap_or(DEFAULT_ACT_SECONDS)
    }

    /// How long one act takes that makes something the table may name (`publish/benefit_decision`): that row if the
    /// table has it, else the block's own (docs/design/foundations.md law 2; F2).
    pub fn of_making(&self, actor: Actor, block: &str, makes: Option<&str>) -> i64 {
        let table = match actor {
            Actor::Person => &self.person,
            Actor::System => &self.system,
        };
        makes.and_then(|m| table.get(m).copied()).unwrap_or_else(|| self.of(actor, block))
    }

    /// A row of the table by its key, as the table has it (none: the table says nothing of it, and no default stands in).
    pub fn row(&self, actor: Actor, key: &str) -> Option<i64> {
        match actor {
            Actor::Person => &self.person,
            Actor::System => &self.system,
        }
        .get(key)
        .copied()
    }

    /// How long a program of several steps takes: the sum of its steps' times, each a block and what it makes if the
    /// block says (never less than a second, so acting always moves time on).
    pub fn program(&self, actor: Actor, steps: impl IntoIterator<Item = (&'static str, Option<String>)>) -> i64 {
        steps.into_iter().map(|(b, m)| self.of_making(actor, b, m.as_deref())).sum::<i64>().max(1)
    }
}

/// A lane that has never been used: free now, whenever now is. The lowest integer the contracts allow (canonical JSON
/// takes integers within ±(2^53 − 1) only, and the timelines are part of the hashed state), so it's below every time a
/// world can have and means what the smallest 64-bit integer meant here until 2026-10-05, which made a state with an
/// unused lane in it impossible to hash or checkpoint.
pub const FREE: i64 = -9_007_199_254_740_991;

/// An actor's timeline: when each of its lanes is next free. Empty: free now.
/// Places an act ready to start at `ready` (after any thinking) and taking `seconds` on the lane that frees first
/// (the lowest-numbered, of those free at the same time): returns when it starts and when it's done.
pub fn place(lanes: &mut Vec<i64>, count: usize, ready: i64, seconds: i64) -> (i64, i64) {
    let count = count.max(1);
    lanes.resize(count.max(lanes.len()), FREE);
    lanes.truncate(count);
    let (i, free) = lanes.iter().copied().enumerate().min_by_key(|&(i, f)| (f, i)).expect("at least one lane");
    let start = ready.max(free);
    let done = start + seconds;
    lanes[i] = done;
    (start, done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn act_times_by_actor_and_kind_with_defaults() {
        let t = ActTimes::from_orchestration(&json!({ "act_time": { "person": { "message": 120 }, "system": { "transfer": 2 }, "default": 30 } }));
        assert_eq!(t.of(Actor::Person, "message"), 120);
        assert_eq!(t.of(Actor::System, "transfer"), 2);
        assert_eq!(t.of(Actor::Person, "transfer"), 30); // the world's default
        assert_eq!(t.program(Actor::Person, [("message", None), ("transfer", None)]), 150);
        let t2 = ActTimes::from_orchestration(&json!({ "act_time": { "person": { "publish": 900, "publish/decision": 2400 } } }));
        assert_eq!(t2.of_making(Actor::Person, "publish", Some("publish/decision")), 2400);
        assert_eq!(t2.of_making(Actor::Person, "publish", Some("publish/notice")), 900);
        assert_eq!(t2.of_making(Actor::System, "publish", Some("publish/decision")), DEFAULT_ACT_SECONDS);
        let none = ActTimes::from_orchestration(&json!({}));
        assert_eq!(none.of(Actor::System, "anything"), DEFAULT_ACT_SECONDS);
    }

    #[test]
    fn a_person_does_one_thing_at_a_time() {
        let mut tl = vec![];
        assert_eq!(place(&mut tl, 1, 100, 60), (100, 160));
        // Ready again at 110, but busy until 160.
        assert_eq!(place(&mut tl, 1, 110, 60), (160, 220));
        // Ready later than it's free: starts when ready.
        assert_eq!(place(&mut tl, 1, 500, 10), (500, 510));
    }

    #[test]
    fn a_system_carries_out_as_many_at_once_as_it_has_lanes() {
        let mut tl = vec![];
        assert_eq!(place(&mut tl, 2, 0, 10), (0, 10));
        assert_eq!(place(&mut tl, 2, 0, 10), (0, 10));
        assert_eq!(place(&mut tl, 2, 0, 10), (10, 20)); // both lanes busy until 10
        // Fewer lanes than before: the rest are dropped.
        assert_eq!(place(&mut tl, 1, 0, 5), (20, 25));
    }

    #[test]
    fn an_unused_lane_is_free_now_and_within_the_contracts_integers() {
        const MAX_SAFE: i64 = 9_007_199_254_740_991;
        let mut tl = vec![];
        assert_eq!(place(&mut tl, 3, 100, 10), (100, 110));
        assert_eq!(tl, vec![110, FREE, FREE]);
        assert!(tl.iter().all(|t| (-MAX_SAFE..=MAX_SAFE).contains(t)));
        // An unused lane before a used one, the lowest-numbered first; then the lane that frees first.
        assert_eq!(place(&mut tl, 3, 50, 100), (50, 150));
        assert_eq!(tl, vec![110, 150, FREE]);
        assert_eq!(place(&mut tl, 3, 0, 5), (0, 5));
        assert_eq!(tl, vec![110, 150, 5]);
        assert_eq!(place(&mut tl, 3, 0, 5), (5, 10));
        // More lanes than before: the new ones are free now.
        assert_eq!(place(&mut tl, 4, 7, 1), (7, 8));
        assert_eq!(tl, vec![110, 150, 10, 8]);
    }
}
