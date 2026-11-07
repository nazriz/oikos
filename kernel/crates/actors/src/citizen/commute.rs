//! Weighing the commute (risk WM-4; docs/behaviour/commuting.md; docs/design/commute-choice.md).
//!
//! A person knows how long a trip takes only from their own trips (law 9 and no god's view): when they set out they
//! note where from and when, and when they see themselves on their way (`BodyView.on_way`) they keep the trip's seconds
//! (`arrives` less when they set out), by the pair of structures, either way round, the latest kept, a bounded memory.
//! A trip they have never made is not known, and a choice that would take them on it carries no commute term (never a
//! straight line, never the network's timetable).
//!
//! A job or a home that implies a known commute carries its cost a month in the person's own terms: the round trip on
//! each working day, its time worth a share of their hourly pay (the place's value of travel time, a profile figure),
//! and, where they drove, an hour's driving at the place's running cost (a profile figure). The mind weighs it as it
//! weighs any money; nothing here refuses a far job or home.

use super::person::Person;
use crate::common::structure_of;
use crate::Picture;

/// How many trips a person keeps (the oldest let go): their home, work, school, shops and a few more.
const KEPT: usize = 16;

impl Person {
    /// Setting out for `to` (the act that moves us is being sent): where from, when, and whether we drive.
    pub fn setting_out(&mut self, pic: &Picture, to: &str) {
        let from = pic.body.as_ref().and_then(|b| b.in_space).map(|sp| structure_of(&sp).to_string());
        self.s.set_out = from.map(|f| (f, structure_of(to).to_string(), pic.t, self.lifecycle.drove.is_some()));
    }

    /// On our way where we set out for: the trip's seconds kept. (Anything else, arrived unseen or refused: not known.)
    pub fn noted_trip(&mut self, pic: &Picture) {
        let Some((from, to, at, drove)) = self.s.set_out.take() else { return };
        let Some(w) = pic.body.as_ref().and_then(|b| b.on_way.as_ref()) else { return };
        if structure_of(&w.to) != to || from == to || w.arrives <= at {
            return;
        }
        self.s.trips.retain(|(a, b, _, _)| !((*a == from && *b == to) || (*a == to && *b == from)));
        self.s.trips.push((from, to, w.arrives - at, drove));
        if self.s.trips.len() > KEPT {
            self.s.trips.remove(0);
        }
    }

    /// A trip between two places as we know it: its seconds and whether we drove. Within one structure: no trip.
    pub fn known_trip(&self, a: &str, b: &str) -> Option<(i64, bool)> {
        let (a, b) = (structure_of(a), structure_of(b));
        if a == b {
            return Some((0, false));
        }
        self.s.trips.iter().rev().find(|(x, y, _, _)| (x == a && y == b) || (x == b && y == a)).map(|(_, _, s, d)| (*s, *d))
    }

    /// What commuting between `home` and `work` would cost us a month (cents), at `pay_per_hour` (cents): `None` where
    /// the place does not say how a commute is weighed, or we have never made the trip.
    pub fn commute_cost(&self, home: &str, work: &str, pay_per_hour: i64) -> Option<i64> {
        let r = self.p.round?;
        let c = r.commute?;
        let (secs, drove) = self.known_trip(home, work)?;
        // (The round trip on each working day: a year's weeks over its months.)
        let secs_a_month = 2 * i128::from(secs) * i128::from(r.work_days) * 52;
        let time = secs_a_month * i128::from(pay_per_hour.max(0)) * i128::from(c.time_bps) / (12 * 3_600 * 10_000);
        let drive = if drove { secs_a_month * i128::from(c.drive_per_hour) / (12 * 3_600) } else { 0 };
        Some(i64::try_from(time + drive).unwrap_or(i64::MAX))
    }
}
