//! World time's semantics (docs/design/rebuild.md section 6): acting costs time. Every act takes its actor time, by the
//! act's kind and the actor's kind (the world's `orchestration.act_time`, and a system template's own rows); the actor is
//! busy until it's done, and it takes effect then. A person has one timeline, shared by every capacity they act in; a
//! system carries out as many acts at once as it has lanes, within its template's hours (law 10, foundations-2).
//!
//! Pure functions: the kernel keeps the timelines in its state and applies acts when they're done.

use serde_json::Value;
use std::collections::BTreeMap;

/// The second it takes to tell someone else to do an act (an act whose work is all others', `by`): the order itself,
/// not the work, which is charged to whoever does it. A convention of the platform, not read from the table (a known
/// limit, docs/all-work-takes-time.md), and not a fallback for an unpriced act: since foundations-2 P2 there is none,
/// and an act nobody priced is refused (`unpriced`).
pub const ORDER_SECONDS: i64 = 1;

/// Who's acting: a person (one timeline) or a system (lanes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    Person,
    System,
}

const DAY: i64 = 86_400;

/// A daily window of work (a template's `hours`, law 10): from `from` seconds after midnight, for `seconds`. A system's
/// lanes work only inside it; work not finished by the window's end goes on in the next day's. Every day is a working
/// day (a known limit: no weekends or holidays for a system's hours yet).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hours {
    pub from: i64,
    pub seconds: i64,
}

impl Hours {
    /// A window the contract allows: it opens within the day and lasts at least a second and at most the whole day.
    pub fn new(from: i64, seconds: i64) -> Option<Self> {
        ((0..DAY).contains(&from) && (1..=DAY).contains(&seconds)).then_some(Hours { from, seconds })
    }

    /// When the window that `t` is in opened (the latest opening at or before `t`).
    fn opened(&self, t: i64) -> i64 {
        (t - self.from).div_euclid(DAY) * DAY + self.from
    }

    /// The first moment of work at or after `t`: `t` itself inside a window, else the next window's opening.
    pub fn open_from(&self, t: i64) -> i64 {
        let opened = self.opened(t);
        if t - opened < self.seconds {
            t
        } else {
            opened + DAY
        }
    }

    /// When `seconds` of work begun at `start` (a moment of work) are done: inside the window if they fit, else carried
    /// on through the next days' windows. Arithmetic, not a walk over the days.
    pub fn finish(&self, start: i64, seconds: i64) -> i64 {
        if seconds <= 0 {
            return start;
        }
        let opened = self.opened(start);
        let left_today = opened + self.seconds - start;
        if seconds <= left_today {
            return start + seconds;
        }
        let rest = seconds - left_today;
        // (Whole windows after today's, then the part of the last.)
        let whole = (rest - 1) / self.seconds;
        opened + DAY * (1 + whole) + (rest - whole * self.seconds)
    }
}

/// A system template's own rows (its `does` rows that state `seconds`, but `work`'s, whose seconds are a unit's: read
/// where the work's labour is) and its hours.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TemplateTimes {
    /// By `block` or `block/kind`, as the world's table is keyed (the narrower is read first).
    pub rows: BTreeMap<String, i64>,
    pub hours: Option<Hours>,
}

/// The world's table of act times (`orchestration.act_time`), and each system template's own rows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActTimes {
    person: BTreeMap<String, i64>,
    system: BTreeMap<String, i64>,
    default: Option<i64>,
    templates: BTreeMap<String, TemplateTimes>,
}

impl ActTimes {
    /// From the world config's `orchestration` (the contract checks its shape).
    pub fn from_orchestration(orchestration: &Value) -> Self {
        let t = &orchestration["act_time"];
        let table = |k: &str| t[k].as_object().map(|m| m.iter().filter_map(|(kind, s)| s.as_i64().map(|s| (kind.clone(), s))).collect()).unwrap_or_default();
        Self { person: table("person"), system: table("system"), default: t["default"].as_i64(), templates: BTreeMap::new() }
    }

    /// With a system template's own rows and hours (made once, at load).
    pub fn with_template(mut self, id: &str, times: TemplateTimes) -> Self {
        if !times.rows.is_empty() || times.hours.is_some() {
            self.templates.insert(id.to_string(), times);
        }
        self
    }

    /// A template's hours, if it states them.
    pub fn hours(&self, template: Option<&str>) -> Option<Hours> {
        self.templates.get(template?)?.hours
    }

    fn table(&self, actor: Actor) -> &BTreeMap<String, i64> {
        match actor {
            Actor::Person => &self.person,
            Actor::System => &self.system,
        }
    }

    /// How long one act takes that makes something the table may name (`publish/benefit_decision`), done by this kind of
    /// actor (and, for a system, one from this template): the template's own row for what is made, then for the block
    /// (never `work`'s, whose template seconds are a unit's); then the world's row for what is made, then for the block;
    /// then the world's stated `default`. None: nobody priced it, and the act is refused (`unpriced`; foundations-2 P2).
    pub fn seconds(&self, actor: Actor, template: Option<&str>, block: &str, makes: Option<&str>) -> Option<i64> {
        if actor == Actor::System && block != "work" {
            if let Some(own) = template.and_then(|t| self.templates.get(t)) {
                if let Some(s) = makes.and_then(|m| own.rows.get(m)).or_else(|| own.rows.get(block)) {
                    return Some(*s);
                }
            }
        }
        let table = self.table(actor);
        makes.and_then(|m| table.get(m)).or_else(|| table.get(block)).copied().or(self.default)
    }

    /// A row of the table by its key, as the table has it (none: the table says nothing of it, and no default stands in).
    pub fn row(&self, actor: Actor, key: &str) -> Option<i64> {
        self.table(actor).get(key).copied()
    }

    /// How long a program of several steps takes: the sum of its steps' times, each a block and what it makes if the
    /// block says (never less than a second, so acting always moves time on). Err: the first step nobody priced (what it
    /// makes, else its block).
    pub fn program<'a>(&self, actor: Actor, template: Option<&str>, steps: impl IntoIterator<Item = (&'a str, Option<String>)>) -> Result<i64, String> {
        let mut sum = 0i64;
        for (b, m) in steps {
            match self.seconds(actor, template, b, m.as_deref()) {
                Some(s) => sum = sum.saturating_add(s),
                None => return Err(m.unwrap_or_else(|| b.to_string())),
            }
        }
        Ok(sum.max(1))
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
    place_within(lanes, count, ready, seconds, None)
}

/// As `place`, for lanes that work only within daily `hours` (a system template's, law 10): the act starts at the first
/// moment of work from when it is ready and its lane is free, and what does not fit in that day's window goes on in the
/// next day's, so that work coming faster than the hours take it is a queue, never a refusal. No hours: any time of day,
/// as a person's timeline is placed (a person's working day is counted where their work is placed).
pub fn place_within(lanes: &mut Vec<i64>, count: usize, ready: i64, seconds: i64, hours: Option<Hours>) -> (i64, i64) {
    let count = count.max(1);
    lanes.resize(count.max(lanes.len()), FREE);
    lanes.truncate(count);
    let (i, free) = lanes.iter().copied().enumerate().min_by_key(|&(i, f)| (f, i)).expect("at least one lane");
    let from = ready.max(free);
    let (start, done) = match hours {
        None => (from, from + seconds),
        Some(h) => {
            let start = h.open_from(from);
            (start, h.finish(start, seconds))
        }
    };
    lanes[i] = done;
    (start, done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn act_times_by_actor_and_kind_with_a_stated_default() {
        let t = ActTimes::from_orchestration(&json!({ "act_time": { "person": { "message": 120 }, "system": { "transfer": 2 }, "default": 30 } }));
        assert_eq!(t.seconds(Actor::Person, None, "message", None), Some(120));
        assert_eq!(t.seconds(Actor::System, None, "transfer", None), Some(2));
        assert_eq!(t.seconds(Actor::Person, None, "transfer", None), Some(30)); // the world's stated default
        assert_eq!(t.program(Actor::Person, None, [("message", None), ("transfer", None)]), Ok(150));
        let t2 = ActTimes::from_orchestration(&json!({ "act_time": { "person": { "publish": 900, "publish/decision": 2400 } } }));
        assert_eq!(t2.seconds(Actor::Person, None, "publish", Some("publish/decision")), Some(2400));
        assert_eq!(t2.seconds(Actor::Person, None, "publish", Some("publish/notice")), Some(900));
    }

    #[test]
    fn an_act_nobody_priced_has_no_time_and_says_which_step() {
        // (No implicit second: foundations-2 P2. The kernel refuses such an act, `unpriced`.)
        let t = ActTimes::from_orchestration(&json!({ "act_time": { "person": { "publish": 900 } } }));
        assert_eq!(t.seconds(Actor::System, None, "publish", Some("publish/decision")), None);
        assert_eq!(t.program(Actor::Person, None, [("publish", Some("publish/x".to_string())), ("transfer", None)]), Err("transfer".to_string()));
        assert_eq!(t.program(Actor::System, None, [("publish", Some("publish/decision".to_string()))]), Err("publish/decision".to_string()));
        let none = ActTimes::from_orchestration(&json!({}));
        assert_eq!(none.seconds(Actor::System, None, "anything", None), None);
    }

    #[test]
    fn a_systems_template_rows_come_first_then_the_worlds() {
        let rows = BTreeMap::from([("publish/benefit_decision".to_string(), 4500), ("message".to_string(), 60), ("work".to_string(), 7)]);
        let t = ActTimes::from_orchestration(&json!({ "act_time": { "system": { "publish": 1, "message": 1, "work": 1, "transfer": 1 } } }))
            .with_template("casework", TemplateTimes { rows, hours: None });
        // Its own row for what is made, then its own for the block.
        assert_eq!(t.seconds(Actor::System, Some("casework"), "publish", Some("publish/benefit_decision")), Some(4500));
        assert_eq!(t.seconds(Actor::System, Some("casework"), "message", None), Some(60));
        // The world's system row where the template says nothing of it, and for any other template.
        assert_eq!(t.seconds(Actor::System, Some("casework"), "publish", Some("publish/notice")), Some(1));
        assert_eq!(t.seconds(Actor::System, Some("casework"), "transfer", None), Some(1));
        assert_eq!(t.seconds(Actor::System, Some("other"), "publish", Some("publish/benefit_decision")), Some(1));
        // A work row's seconds are a unit's (read where the work's labour is): not the act's.
        assert_eq!(t.seconds(Actor::System, Some("casework"), "work", Some("work/x".to_string()).as_deref()), Some(1));
        // A person is never read from a template.
        assert_eq!(t.seconds(Actor::Person, Some("casework"), "message", None), None);
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

    const H: i64 = 3_600;

    #[test]
    fn hours_are_a_window_of_the_day() {
        assert_eq!(Hours::new(-1, H), None);
        assert_eq!(Hours::new(DAY, H), None);
        assert_eq!(Hours::new(0, 0), None);
        assert_eq!(Hours::new(0, DAY + 1), None);
        assert!(Hours::new(0, DAY).is_some());
        let h = Hours::new(9 * H, 8 * H).unwrap();
        // Inside the window: now. Before it: its opening. After it: tomorrow's.
        assert_eq!(h.open_from(10 * H), 10 * H);
        assert_eq!(h.open_from(9 * H), 9 * H);
        assert_eq!(h.open_from(3 * H), 9 * H);
        assert_eq!(h.open_from(17 * H), DAY + 9 * H);
        assert_eq!(h.open_from(23 * H), DAY + 9 * H);
        // Long before the world began, and a lane never used.
        assert_eq!(h.open_from(-DAY + 20 * H), 9 * H);
        assert!(h.open_from(FREE) <= 9 * H);
    }

    #[test]
    fn work_that_does_not_fit_the_day_goes_on_the_next_and_is_never_refused() {
        let h = Some(Hours::new(9 * H, 8 * H).unwrap());
        let mut tl = vec![];
        // Ready at 3 in the morning: begins at 9, an hour and a quarter's case done at a quarter past ten.
        assert_eq!(place_within(&mut tl, 1, 3 * H, 4_500, h), (9 * H, 9 * H + 4_500));
        // Ready at 4 in the afternoon, two hours' work: one today, one tomorrow from 9.
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 1, 16 * H, 2 * H, h), (16 * H, DAY + 10 * H));
        // Exactly the rest of the day: done at closing, not tomorrow.
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 1, 16 * H, H, h), (16 * H, 17 * H));
        // Twenty hours of work begun at opening: 8 + 8 + 4, done at 1 in the afternoon of the third day.
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 1, 9 * H, 20 * H, h), (9 * H, 2 * DAY + 13 * H));
        // Exactly three windows: done at the third day's closing.
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 1, 0, 24 * H, h), (9 * H, 2 * DAY + 17 * H));
        // After closing, nothing begins until tomorrow; a queue builds on the lane, and a second lane takes the next.
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 2, 18 * H, 4 * H, h), (DAY + 9 * H, DAY + 13 * H));
        assert_eq!(place_within(&mut tl, 2, 18 * H, 4 * H, h), (DAY + 9 * H, DAY + 13 * H));
        assert_eq!(place_within(&mut tl, 2, 18 * H, 6 * H, h), (DAY + 13 * H, 2 * DAY + 11 * H));
        // Zero seconds: when it could begin (what the kernel asks to learn when a lane is next free for work).
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 1, 20 * H, 0, h), (DAY + 9 * H, DAY + 9 * H));
        // A window across midnight: from 10 at night for 8 hours.
        let n = Some(Hours::new(22 * H, 8 * H).unwrap());
        let mut tl = vec![];
        assert_eq!(place_within(&mut tl, 1, 12 * H, 3 * H, n), (22 * H, DAY + H));
        assert_eq!(place_within(&mut tl, 1, DAY + 5 * H, 2 * H, n), (DAY + 5 * H, DAY + 22 * H + H));
        // All day is as no hours.
        let all = Some(Hours::new(0, DAY).unwrap());
        let (mut a, mut b) = (vec![], vec![]);
        for (ready, secs) in [(5, 100), (7, DAY * 3), (DAY * 2, 50)] {
            assert_eq!(place_within(&mut a, 1, ready, secs, all), place(&mut b, 1, ready, secs));
        }
    }
}
