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

    /// How long a program of several steps takes: the sum of its steps' times (never less than a second, so acting
    /// always moves time on).
    pub fn program<'a>(&self, actor: Actor, kinds: impl IntoIterator<Item = &'a str>) -> i64 {
        kinds.into_iter().map(|k| self.of(actor, k)).sum::<i64>().max(1)
    }
}

/// An actor's timeline: when each of its lanes is next free. Empty: free now.
/// Places an act ready to start at `ready` (after any thinking) and taking `seconds` on the lane that frees first
/// (the lowest-numbered, of those free at the same time): returns when it starts and when it's done.
pub fn place(lanes: &mut Vec<i64>, count: usize, ready: i64, seconds: i64) -> (i64, i64) {
    let count = count.max(1);
    lanes.resize(count.max(lanes.len()), i64::MIN);
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
        assert_eq!(t.program(Actor::Person, ["message", "transfer"]), 150);
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
}
