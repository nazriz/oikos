//! The one way a decision goes wrong by chance (docs/design/foundations.md, law 5; foundations F7). Ported from
//! participants/src/slip.ts. An error comes from a procedure that differs from the law, stale or missing data, too
//! little time, or a slip: a performer doing the work right most of the time and wrong at a sourced rate. Only the
//! last is chance, and this is the only place an actor draws it. The rate is a row of the world's table of slips
//! (`orchestration.slip`) for the kind of performer; a task with no row has no slip. The draw is from the stream named
//! `slip-<task>-<case>`, so a town and its twin slip on the same cases.

use oikos_core::rng::Rng;
use serde::Deserialize;
use std::collections::BTreeMap;

/// A row of the table of slips.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SlipRow {
    /// Basis points: of the acts of this kind (`per: act`), or of the exposed in a year (`per: year`).
    pub bps: i64,
    #[serde(default)]
    pub per: Option<String>,
    /// Whether the world's friction dial (`dials.friction_bps`) scales it.
    #[serde(default)]
    pub friction: bool,
}

/// The world's table of slips (`orchestration.slip`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct SlipTable {
    #[serde(default)]
    pub person: BTreeMap<String, SlipRow>,
    #[serde(default)]
    pub system: BTreeMap<String, SlipRow>,
    #[serde(default)]
    pub sources: BTreeMap<String, String>,
}

/// Whether the performer is a person or a system (a system's row is its own).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Performer {
    #[default]
    Person,
    System,
}

/// What `slip` needs of whoever draws: its keyed stream for a purpose, what kind of performer it is, the table and the
/// friction dial.
pub trait Slipper {
    fn rng(&mut self, purpose: &str) -> Rng;
    fn performer(&self) -> Performer;
    fn slip_table(&self) -> Option<&SlipTable>;
    /// `dials.friction_bps` (0 or absent: no friction arises).
    fn friction_bps(&self) -> i64;
}

/// Options for a draw: the days of exposure (a row per year), and the performer's own lean on the rate.
#[derive(Default)]
pub struct SlipOptions<'a> {
    pub days: i64,
    pub lean: Option<&'a dyn Fn(i64) -> i64>,
}

/// The row for a task, for the kind of performer.
pub fn slip_row<'a>(s: &'a impl Slipper, task: &str) -> Option<&'a SlipRow> {
    let t = s.slip_table()?;
    match s.performer() {
        Performer::Person => t.person.get(task),
        Performer::System => t.system.get(task),
    }
}

/// The chance, in parts per million, of a slip at a task.
pub fn slip_ppm(s: &impl Slipper, task: &str, o: &SlipOptions) -> i64 {
    let Some(row) = slip_row(s, task) else { return 0 };
    if row.bps <= 0 {
        return 0;
    }
    let dial = if row.friction { s.friction_bps().max(0) } else { 10_000 };
    if dial <= 0 {
        return 0;
    }
    let bps = o.lean.map_or(row.bps, |f| f(row.bps));
    if bps <= 0 {
        return 0;
    }
    if row.per.as_deref() == Some("year") {
        if o.days <= 0 {
            return 0;
        }
        return (bps * dial * o.days / (100 * 365)).min(1_000_000);
    }
    (bps.min(10_000) * dial / 100).min(1_000_000)
}

/// Does the performer slip at this task, on this case? `case` names the case (what it is and which time it was for
/// the pair; never a paper's number).
pub fn slip(s: &mut impl Slipper, task: &str, case: &str, o: &SlipOptions) -> bool {
    let ppm = slip_ppm(s, task, o);
    ppm > 0 && (s.rng(&format!("slip-{task}-{case}")).below(1_000_000) as i64) < ppm
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_core::rng::Randomness;

    struct T(SlipTable, Performer, i64);
    impl Slipper for T {
        fn rng(&mut self, purpose: &str) -> Rng {
            Randomness::new(1).stream(&[purpose])
        }
        fn performer(&self) -> Performer {
            self.1
        }
        fn slip_table(&self) -> Option<&SlipTable> {
            Some(&self.0)
        }
        fn friction_bps(&self) -> i64 {
            self.2
        }
    }
    fn table() -> SlipTable {
        serde_json::from_value(serde_json::json!({ "person": { "publish/x": { "bps": 500 }, "y": { "bps": 1000, "per": "year", "friction": true } }, "system": { "publish/x": { "bps": 1 } } })).unwrap()
    }

    #[test]
    fn a_rate_per_act_a_rate_per_year_scaled_by_friction_and_a_systems_own_row() {
        let p = T(table(), Performer::Person, 5000);
        assert_eq!(slip_ppm(&p, "publish/x", &SlipOptions::default()), 50_000);
        assert_eq!(slip_ppm(&p, "y", &SlipOptions { days: 365, lean: None }), 50_000);
        assert_eq!(slip_ppm(&p, "y", &SlipOptions::default()), 0, "no days of exposure, no slip");
        assert_eq!(slip_ppm(&p, "none", &SlipOptions::default()), 0, "no row, no slip");
        let s = T(table(), Performer::System, 5000);
        assert_eq!(slip_ppm(&s, "publish/x", &SlipOptions::default()), 100);
        let off = T(table(), Performer::Person, 0);
        assert_eq!(slip_ppm(&off, "y", &SlipOptions { days: 365, lean: None }), 0, "friction off: none arises");
        let lean = |b: i64| b * 2;
        assert_eq!(slip_ppm(&p, "publish/x", &SlipOptions { days: 0, lean: Some(&lean) }), 100_000);
    }

    #[test]
    fn the_draw_is_named_for_the_task_and_the_case() {
        let mut p = T(table(), Performer::Person, 10_000);
        let a: Vec<bool> = (0..200).map(|i| slip(&mut p, "publish/x", &format!("c{i}"), &SlipOptions::default())).collect();
        let b: Vec<bool> = (0..200).map(|i| slip(&mut p, "publish/x", &format!("c{i}"), &SlipOptions::default())).collect();
        assert_eq!(a, b);
        let n = a.iter().filter(|x| **x).count();
        assert!((3..=20).contains(&n), "about 5% of 200: {n}");
    }
}
