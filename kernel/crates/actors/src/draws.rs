//! How a unit's random streams are named (docs/reliability.md, "Draws and the moment" and "Draws and the order papers
//! were filed in"), ported from orchestrator/src/run.ts (`drawFor`, `stablePurpose`). Each unit keeps its own count,
//! so the names do not depend on which thread steps it or on who else steps first.
//!
//! - A purpose naming a record (`rec.123`) names it as "the nth such paper this unit has drawn on for this purpose"
//!   (`paper#n`): a record's number depends on how many records the town made, a draw must not.
//! - A draw that names its matter (a `#` and a digit, or five digits in a row) is that matter's: the nth time this unit
//!   drew for it. Any other draw is the calendar day's, and the nth time that day. The nth is counted by moments:
//!   drawing again in the same moment is the same occurrence.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Serialisable: a snapshot keeps every unit's counts, so a resumed or forked run draws as the original would.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Draws {
    participant: String,
    capacity: String,
    day: i64,
    day_occurrences: BTreeMap<String, (i64, u64)>,
    matter_occurrences: BTreeMap<String, (i64, u64)>,
    drawn_on: BTreeMap<String, BTreeMap<String, usize>>,
}

/// Every `rec.<digits>` in `s`, each replaced by `f(the id)`.
fn replace_records(s: &str, mut f: impl FnMut(&str) -> String) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if b[i..].starts_with(b"rec.") && b.get(i + 4).is_some_and(u8::is_ascii_digit) {
            let mut j = i + 4;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            out.push_str(&f(&s[i..j]));
            i = j;
        } else {
            let c = s[i..].chars().next().unwrap_or_default();
            out.push(c);
            i += c.len_utf8();
        }
    }
    out
}

/// Whether a purpose names its matter: `#` then a digit, or five digits in a row.
fn names_matter(p: &str) -> bool {
    let b = p.as_bytes();
    let hash_digit = b.windows(2).any(|w| w[0] == b'#' && w[1].is_ascii_digit());
    let mut run = 0;
    let five = b.iter().any(|c| {
        run = if c.is_ascii_digit() { run + 1 } else { 0 };
        run >= 5
    });
    hash_digit || five
}

impl Draws {
    pub fn new(participant: &str, capacity: &str) -> Self {
        Draws { participant: participant.into(), capacity: capacity.into(), day: -1, ..Default::default() }
    }

    fn stable(&mut self, purpose: &str) -> String {
        if !purpose.contains("rec.") {
            return purpose.to_string();
        }
        let what = replace_records(purpose, |_| "rec".into());
        let seen = self.drawn_on.entry(what).or_default();
        replace_records(purpose, |id| {
            let n = seen.len() + 1;
            let k = *seen.entry(id.to_string()).or_insert(n);
            format!("paper#{k}")
        })
    }

    /// The key of the stream for `purpose` at moment `t` (`["participant", pid, capacity, day or "", purpose, n]`).
    pub fn key(&mut self, t: i64, purpose: &str) -> Vec<String> {
        let purpose = self.stable(purpose);
        let day = t.div_euclid(86_400);
        if day != self.day {
            self.day_occurrences.clear();
            self.day = day;
        }
        let matter = names_matter(&purpose);
        let seen = if matter { &mut self.matter_occurrences } else { &mut self.day_occurrences };
        let occ = seen.entry(purpose.clone()).or_insert((t, 0));
        if occ.1 == 0 || occ.0 != t {
            occ.0 = t;
            occ.1 += 1;
        }
        let n = occ.1.to_string();
        vec![
            "participant".into(),
            self.participant.clone(),
            self.capacity.clone(),
            if matter { String::new() } else { day.to_string() },
            purpose,
            n,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draw_is_named_for_the_day_and_its_occurrence_counted_by_moment() {
        let mut d = Draws::new("p1", "self");
        assert_eq!(d.key(100, "shop"), ["participant", "p1", "self", "0", "shop", "1"]);
        assert_eq!(d.key(100, "shop")[5], "1", "the same moment: the same occurrence");
        assert_eq!(d.key(200, "shop")[5], "2");
        assert_eq!(d.key(86_400 + 5, "shop"), ["participant", "p1", "self", "1", "shop", "1"], "a new day starts again");
    }

    #[test]
    fn a_paper_is_named_for_which_paper_it_is_to_the_drawer_and_a_matter_is_its_own() {
        let mut d = Draws::new("p1", "pos");
        assert_eq!(d.key(0, "answer-rec.977")[4], "answer-paper#1");
        assert_eq!(d.key(0, "answer-rec.12")[4], "answer-paper#2");
        assert_eq!(d.key(9, "answer-rec.977")[4], "answer-paper#1");
        let k = d.key(9, "answer-rec.977");
        assert_eq!((k[3].as_str(), k[5].as_str()), ("", "2"), "a matter's draw: no day, its own count");
        assert_eq!(d.key(0, "lease-12345")[3], "");
    }
}
