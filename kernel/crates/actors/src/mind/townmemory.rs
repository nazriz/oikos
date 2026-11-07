//! participants/src/behaviour/townmemory.ts, in Rust (lane A2): what a person carries of what happened to others and
//! was public (docs/design/ai-citizens.md 14e; docs/behaviour/culture.md, "Town memory").
//!
//! A few typed slots in one person's own record, each with a strength that fades and a count of the hands it passed
//! through. An event reaches a person three ways and no fourth: they were there, it was published and they read it, or
//! someone they know told them. Fading is worked out when read (nothing runs daily); there is no draw. What an event
//! does to trust is the sign of the person's OWN view of the conduct it shows, never the platform's. Every size is a
//! placeholder (risk PC-3).
//!
//! Decided fresh for Rust:
//! - A strength is `round(s0 x 0.5^(elapsed / half))` with `math::halved` and `math::round` (JavaScript's half up);
//!   a told strength (`pass` of the teller's) is a float only until `take` rounds it.
//! - Each slot's `told` keeps insertion order (a Vec: the oldest of 40 gives way, as TS's Set did); `seen` likewise.
//! - The section is cached as TS's was; `section_version()` counts the times it was worked out anew, where TS's caller
//!   compared the array's identity. The cache and version are saved with the rest.
//! - The parser of `town_words::say` (a regular expression in TS) is written by hand to the same first match; a count of
//!   19 digits or more is no match.

use super::culture::{saying, CultureParams, Conduct, SAYINGS};
use super::math;
use serde::{Deserialize, Serialize};

const DAY: i64 = 86_400;

/// What a person may remember of the town, in the order the record keeps them (TS `EVENT_KINDS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    PutOut,
    Strike,
    Ruling,
    Law,
    Vote,
    Founded,
}
pub const EVENT_KINDS: [EventKind; 6] = [EventKind::PutOut, EventKind::Strike, EventKind::Ruling, EventKind::Law, EventKind::Vote, EventKind::Founded];

impl EventKind {
    pub fn name(self) -> &'static str {
        match self {
            EventKind::PutOut => "put_out",
            EventKind::Strike => "strike",
            EventKind::Ruling => "ruling",
            EventKind::Law => "law",
            EventKind::Vote => "vote",
            EventKind::Founded => "founded",
        }
    }
    pub fn from_name(s: &str) -> Option<EventKind> {
        EVENT_KINDS.into_iter().find(|k| k.name() == s)
    }
    pub fn index(self) -> usize {
        self as usize
    }
    /// Words for each kind, in the world's terms and without a judgement (TS `KIND_WORDS`).
    pub fn words(self) -> &'static str {
        match self {
            EventKind::PutOut => "a household put out of its home",
            EventKind::Strike => "a walk-out from work",
            EventKind::Ruling => "a decision published",
            EventKind::Law => "a law made",
            EventKind::Vote => "a result declared",
            EventKind::Founded => "a body founded",
        }
    }
}

/// How an event reached me.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum How {
    Saw,
    Read,
    Told,
}
impl How {
    pub fn index(self) -> usize {
        self as usize
    }
}

/// The conduct an event shows (TS `EVENT_CONDUCT`): for the sign of its bearing on trust.
pub fn event_conduct(kind: EventKind) -> Option<Conduct> {
    match kind {
        EventKind::PutOut => Some(Conduct::ApplyPossession),
        EventKind::Strike => Some(Conduct::Strike),
        _ => None,
    }
}

/// The conducts an event is an instance of (TS `EVENT_CONDUCTS`): a removal is a landlord applying for possession and a
/// household staying past the notice; a walk-out is acting on a ballot. The first is the one whose said view travels.
pub fn event_conducts(kind: EventKind) -> &'static [Conduct] {
    match kind {
        EventKind::PutOut => &[Conduct::ApplyPossession, Conduct::StayPastNotice],
        EventKind::Strike => &[Conduct::Strike],
        _ => &[],
    }
}

/// Which way an event bears on trust in whoever did it, for a person whose own view of the conduct is `own_bps`: +1, -1,
/// or 0 (no view, or no conduct shown). A removal held right is the doer vindicated; a walk-out held right is the
/// employer's trust lost.
pub fn trust_direction(kind: EventKind, own_bps: i64) -> i64 {
    if own_bps == 5_000 || event_conduct(kind).is_none() {
        return 0;
    }
    let up = if kind == EventKind::PutOut { own_bps > 5_000 } else { own_bps < 5_000 };
    if up {
        1
    } else {
        -1
    }
}

/// What a `town_words::say` phrase tells.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TownHeard {
    pub kind: EventKind,
    pub about: String,
    pub day: i64,
    /// The teller's strength, basis points (tenths times 1,000).
    pub strength: i64,
    pub hops: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub says: Option<i64>,
}

/// TS `TOWN_WORDS`: a code person's phrasing, byte for byte TS's, and its parser.
pub mod town_words {
    use super::*;

    /// "Talk of the town: <kind>, <about>, day <d>; I hold it at <s> in 10, through <h> hand[s]." and, where given, what I say of it.
    pub fn say(kind: EventKind, about: &str, day: i64, strength_bps: i64, hops: i64, says_bps: Option<i64>) -> String {
        let tenths = super::super::culture::round_div(strength_bps, 1_000).clamp(1, 10);
        let mut s = format!("Talk of the town: {}, {about}, day {day}; I hold it at {tenths} in 10, through {hops} {}.", kind.words(), if hops == 1 { "hand" } else { "hands" });
        if let Some(b) = says_bps {
            s.push_str(&format!(" Of that, I say it is {}.", saying(b)));
        }
        s
    }

    fn digits(s: &str) -> Option<(i64, &str)> {
        let n = s.bytes().take_while(|b| b.is_ascii_digit()).count();
        if n == 0 {
            return None;
        }
        Some((s[..n].parse().ok()?, &s[n..]))
    }

    /// One try at a position just after "Talk of the town: ".
    fn at(rest: &str) -> Option<TownHeard> {
        let kind = EVENT_KINDS.into_iter().find(|k| rest.starts_with(k.words()))?;
        let rest = rest[kind.words().len()..].strip_prefix(", ")?;
        // ([^\s,]+), then ", day "
        let n: usize = rest.chars().take_while(|&c| !(c.is_whitespace() || c == '\u{feff}' || c == ',')).map(char::len_utf8).sum();
        if n == 0 {
            return None;
        }
        let about = &rest[..n];
        let rest = rest[n..].strip_prefix(", day ")?;
        let (day, rest) = digits(rest)?;
        let rest = rest.strip_prefix("; I hold it at ")?;
        let (tenths, rest) = digits(rest)?;
        let rest = rest.strip_prefix(" in 10, through ")?;
        let (hops, rest) = digits(rest)?;
        let rest = rest.strip_prefix(" hand")?;
        let rest = rest.strip_prefix("s.").or_else(|| rest.strip_prefix('.'))?;
        let says = rest.strip_prefix(" Of that, I say it is ").and_then(|r| SAYINGS.iter().find(|(w, _)| r.starts_with(w) && r[w.len()..].starts_with('.')).map(|(_, mid)| *mid));
        Some(TownHeard { kind, about: about.to_string(), day, strength: tenths * 1_000, hops, says })
    }

    /// What a phrase tells (found anywhere in a message): the first match, as TS's regular expression finds it.
    pub fn heard(text: &str) -> Option<TownHeard> {
        const P: &str = "Talk of the town: ";
        let mut from = 0;
        while let Some(i) = text[from..].find(P) {
            let start = from + i;
            if let Some(h) = at(&text[start + P.len()..]) {
                return Some(h);
            }
            from = start + 1;
        }
        None
    }
}

/// The paper's own weight for an item by the kind of record it reports (TS `PAPER_WEIGHT`), and the kind it is.
pub fn paper_weight(record: &str) -> Option<(EventKind, i64)> {
    match record {
        "law" => Some((EventKind::Law, 2)),
        "budget" => Some((EventKind::Law, 2)),
        "ballot_result" => Some((EventKind::Vote, 4)),
        "permit_decision" => Some((EventKind::Ruling, 1)),
        _ => None,
    }
}
const PAPER_HEAVIEST: i64 = 4;
/// An event read in the paper is held at `read_bps` times its weight over the heaviest.
pub fn paper_strength(weight: i64, p: &CultureParams) -> i64 {
    math::round((p.read_bps * weight.min(PAPER_HEAVIEST)) as f64 / PAPER_HEAVIEST as f64)
}

/// One thing remembered. `first` is how strongly it was first held (rehearsal returns to it); `s0` how strongly at `at`
/// (seconds); it fades from there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Slot {
    pub kind: EventKind,
    pub about: String,
    pub day: i64,
    pub how: How,
    pub hops: i64,
    pub first: i64,
    pub s0: i64,
    pub at: i64,
    /// To whom told, in the order told (at most 40).
    pub told: Vec<String>,
}

/// A slot as the record holds it: [kind, about, event day, strength at `at` (whole percent), how, hops, `at` (day)].
pub type HeardRow = (i64, String, i64, i64, i64, i64, i64);
pub type HeardSection = Vec<HeardRow>;

/// What became of an event that reached me.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Taken {
    Fresh,
    Again,
    Dropped,
}

/// What a person remembers of the town: at most `slots` events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TownMemory {
    pub p: std::sync::Arc<CultureParams>,
    held: Vec<Slot>,
    cached: Option<HeardSection>,
    dirty: bool,
    version: u64,
    /// Sightings already taken in, in order (at most 200).
    seen: Vec<String>,
}

impl TownMemory {
    pub fn new(p: impl Into<std::sync::Arc<CultureParams>>) -> TownMemory {
        let p = p.into();
        TownMemory { p, held: vec![], cached: None, dirty: true, version: 0, seen: vec![] }
    }

    fn half(&self, how: How) -> i64 {
        (if how == How::Saw { self.p.half_life_seen_days } else { self.p.half_life_told_days }) * DAY
    }
    /// How strongly a slot is held at `now` (basis points).
    pub fn strength(&self, s: &Slot, now: i64) -> i64 {
        math::round(s.s0 as f64 * math::halved((now - s.at).max(0) as f64, self.half(s.how) as f64))
    }
    fn find(&self, kind: EventKind, about: &str, day: i64) -> Option<usize> {
        self.held.iter().position(|s| s.kind == kind && s.about == about && s.day == day)
    }
    pub fn all(&self) -> &[Slot] {
        &self.held
    }
    pub fn size(&self) -> usize {
        self.held.len()
    }

    /// How strongly I hold a thing now, or 0.
    pub fn strength_of(&self, kind: EventKind, about: &str, event_t: i64, now: i64) -> i64 {
        self.find(kind, about, event_t.div_euclid(DAY)).map_or(0, |i| self.strength(&self.held[i], now))
    }
    /// A sighting not yet counted (by key); remembered to a bound.
    pub fn new_sighting(&mut self, key: &str) -> bool {
        if self.seen.iter().any(|k| k == key) {
            return false;
        }
        self.seen.push(key.to_string());
        if self.seen.len() > 200 {
            self.seen.remove(0);
        }
        true
    }

    /// An event reaches me at `strength`: a slot made (`Fresh`), rehearsed (`Again`), or `Dropped` (past `max_hops`, or
    /// weaker than everything held with the slots full).
    #[allow(clippy::too_many_arguments)]
    pub fn take(&mut self, kind: EventKind, about: &str, event_t: i64, now: i64, how: How, strength: f64, hops: i64) -> Taken {
        if hops > self.p.max_hops {
            return Taken::Dropped;
        }
        let day = event_t.div_euclid(DAY);
        let s = math::round(strength).clamp(0, 10_000);
        if let Some(i) = self.find(kind, about, day) {
            let now_ = self.strength(&self.held[i], now);
            let rehearse = self.p.rehearse_bps;
            let old = &mut self.held[i];
            old.s0 = 10_000.min(math::round(now_ as f64 + ((old.first - now_) * rehearse) as f64 / 10_000.0));
            old.at = now;
            // (Seen is seen: a thing I saw does not become a thing I only heard.)
            if hops < old.hops {
                old.hops = hops;
            }
            self.dirty = true;
            return Taken::Again;
        }
        if self.held.len() as i64 >= self.p.slots {
            let mut weakest = 0;
            for i in 1..self.held.len() {
                if self.strength(&self.held[i], now) < self.strength(&self.held[weakest], now) {
                    weakest = i;
                }
            }
            if self.strength(&self.held[weakest], now) >= s {
                return Taken::Dropped;
            }
            self.held.remove(weakest);
        }
        self.held.push(Slot { kind, about: about.to_string(), day, how, hops, first: s, s0: s, at: now, told: vec![] });
        self.dirty = true;
        Taken::Fresh
    }

    /// I saw it: my own place put me there.
    pub fn saw(&mut self, kind: EventKind, about: &str, event_t: i64, now: i64) -> Taken {
        let s = self.p.seen_bps as f64;
        self.take(kind, about, event_t, now, How::Saw, s, 0)
    }
    /// I read it (a published paper's item).
    pub fn read(&mut self, kind: EventKind, about: &str, event_t: i64, now: i64, strength: i64) -> Taken {
        self.take(kind, about, event_t, now, How::Read, strength as f64, 0)
    }
    /// Someone I know told me, holding it at `teller_strength` through `hops` hands; the hearing is `pass_bps` of that,
    /// and `negative_bps` more for what I hold against.
    #[allow(clippy::too_many_arguments)]
    pub fn heard_from(&mut self, kind: EventKind, about: &str, day: i64, now: i64, teller_strength: i64, hops: i64, holds_against: bool) -> Taken {
        let pass = self.p.pass_bps + if holds_against { self.p.negative_bps } else { 0 };
        let s = 10_000f64.min((teller_strength * pass) as f64 / 10_000.0);
        self.take(kind, about, day * DAY, now, How::Told, s, hops + 1)
    }

    /// What I tell someone who asks how things are: the one thing I hold strongest, above `tell_at_bps`, not told them
    /// before (ties: the later day, then `about` in byte order). `view` gives what I say of a kind's conduct, if anything.
    pub fn tell(&mut self, asker: &str, now: i64, view: Option<&dyn Fn(EventKind) -> Option<i64>>) -> Option<String> {
        let mut best: Option<(usize, i64)> = None;
        for (i, s) in self.held.iter().enumerate() {
            if s.told.iter().any(|a| a == asker) {
                continue;
            }
            let v = self.strength(s, now);
            if v < self.p.tell_at_bps {
                continue;
            }
            let better = match best {
                None => true,
                Some((b, bv)) => {
                    let b = &self.held[b];
                    v > bv || (v == bv && (s.day > b.day || (s.day == b.day && s.about < b.about)))
                }
            };
            if better {
                best = Some((i, v));
            }
        }
        let (i, v) = best?;
        let s = &mut self.held[i];
        s.told.push(asker.to_string());
        if s.told.len() > 40 {
            s.told.remove(0);
        }
        let (kind, day, hops) = (s.kind, s.day, s.hops);
        let about = s.about.clone();
        Some(town_words::say(kind, &about, day, v, hops, view.and_then(|f| f(kind))))
    }

    /// The record's section, positional and small; the same until something arrives (`section_version` says when it was
    /// worked out anew).
    pub fn section(&mut self) -> &HeardSection {
        if self.cached.is_none() || self.dirty {
            self.dirty = false;
            self.cached = Some(
                self.held
                    .iter()
                    .map(|s| (s.kind.index() as i64, s.about.clone(), s.day, super::culture::round_div(s.s0, 100), s.how.index() as i64, s.hops, s.at.div_euclid(DAY)))
                    .collect(),
            );
            self.version += 1;
        }
        self.cached.as_ref().unwrap()
    }
    pub fn section_version(&self) -> u64 {
        self.version
    }
}

/// The strength of a row of the record at day `day` (whole percent, unrounded), as anyone reading the record works it out.
pub fn row_strength_pct(row: &HeardRow, day: i64, p: &CultureParams) -> f64 {
    let half = if row.4 == How::Saw.index() as i64 { p.half_life_seen_days } else { p.half_life_told_days };
    row.3 as f64 * math::halved((day - row.6).max(0) as f64, half as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mind::culture::CULTURE_DEFAULTS;

    fn mem() -> TownMemory {
        TownMemory::new(CULTURE_DEFAULTS)
    }

    #[test]
    fn never_more_than_six_the_weakest_gives_way() {
        let mut m = mem();
        for i in 0..6 {
            assert_eq!(m.read(EventKind::Law, &format!("maker-{i}"), i * DAY, 10 * DAY, 3_000 + i * 100), Taken::Fresh);
        }
        assert_eq!(m.size(), 6);
        assert_eq!(m.read(EventKind::Law, "weaker", 0, 10 * DAY, 2_000), Taken::Dropped);
        assert_eq!(m.saw(EventKind::PutOut, "police", 9 * DAY, 10 * DAY), Taken::Fresh);
        assert_eq!(m.size(), 6);
        assert!(!m.all().iter().any(|s| s.about == "maker-0"));
        for i in 0..200 {
            m.saw(EventKind::Strike, &format!("e-{i}"), i * DAY, 10 * DAY + i);
        }
        assert!(m.size() <= 6);
    }

    #[test]
    fn nothing_past_three_hands_and_told_is_a_part_of_the_tellers_strength() {
        let mut m = mem();
        assert_eq!(m.heard_from(EventKind::PutOut, "police", 5, 6 * DAY, 10_000, 3, false), Taken::Dropped);
        assert_eq!(m.heard_from(EventKind::PutOut, "police", 5, 6 * DAY, 10_000, 2, false), Taken::Fresh);
        assert_eq!((m.all()[0].hops, m.all()[0].s0), (3, 6_000));
        let mut n = mem();
        n.heard_from(EventKind::PutOut, "police", 5, 6 * DAY, 10_000, 0, true);
        assert_eq!(n.all()[0].s0, 8_000);
    }

    #[test]
    fn strength_fades_by_the_formula_and_rehearsal_returns_part_of_the_way() {
        let mut m = mem();
        m.saw(EventKind::PutOut, "police", 0, 0);
        m.read(EventKind::Law, "town", 0, 0, 4_000);
        let (seen, read) = (m.all()[0].clone(), m.all()[1].clone());
        assert_eq!(m.strength(&seen, 365 * DAY), 5_000);
        assert_eq!(m.strength(&read, 180 * DAY), 2_000);
        assert_eq!(m.strength(&read, 360 * DAY), 1_000);
        assert_eq!(m.heard_from(EventKind::PutOut, "police", 0, 365 * DAY, 8_000, 0, false), Taken::Again);
        assert_eq!(m.strength(&m.all()[0].clone(), 365 * DAY), 6_500);
        let row = m.section()[0].clone();
        assert_eq!(row.0, EventKind::PutOut.index() as i64);
        assert!((row_strength_pct(&row, 730, &CULTURE_DEFAULTS) - 32.5).abs() < 1e-5);
    }

    #[test]
    fn the_section_is_positional_small_and_the_same_until_something_arrives() {
        let mut m = mem();
        assert!(m.section().is_empty());
        m.saw(EventKind::PutOut, "police", 100 * DAY, 101 * DAY);
        m.read(EventKind::Vote, "council", 90 * DAY, 101 * DAY, 4_000);
        let a = m.section().clone();
        let v = m.section_version();
        assert!(serde_json::to_string(&a).unwrap().len() < 120);
        assert_eq!(serde_json::to_string(&a).unwrap(), r#"[[0,"police",100,100,0,0,101],[4,"council",90,40,1,0,101]]"#);
        m.section();
        m.tell("x", 400 * DAY, None);
        m.section();
        assert_eq!(m.section_version(), v); // (telling changes no row)
        m.saw(EventKind::Strike, "works", 500 * DAY, 501 * DAY);
        m.section();
        assert_eq!(m.section_version(), v + 1);
    }

    #[test]
    fn telling_the_strongest_once_to_each_and_the_words_round_trip() {
        let mut m = mem();
        m.read(EventKind::Law, "town", 10 * DAY, 11 * DAY, 3_000);
        m.saw(EventKind::PutOut, "police", 20 * DAY, 21 * DAY);
        let first = m.tell("a", 22 * DAY, None).unwrap();
        assert_eq!(first, "Talk of the town: a household put out of its home, police, day 20; I hold it at 10 in 10, through 0 hands.");
        let h = town_words::heard(&first).unwrap();
        assert_eq!((h.kind, h.about.as_str(), h.day, h.hops), (EventKind::PutOut, "police", 20, 0));
        assert_eq!(town_words::heard(&m.tell("a", 22 * DAY, None).unwrap()).unwrap().kind, EventKind::Law);
        assert_eq!(m.tell("a", 22 * DAY, None), None);
        assert!(m.tell("b", 22 * DAY, None).is_some());
        assert_eq!(m.tell("c", 3_000 * DAY, None), None);
        assert_eq!(town_words::heard(&format!("Much the same. {first} Nothing else.")).unwrap().kind, EventKind::PutOut);
        assert_eq!(town_words::heard("Talk of the town: a ruling by the moon, x, day 3; I hold it at 5 in 10, through 0 hands."), None);
        // What is said travels with it.
        let t = town_words::say(EventKind::Strike, "works", 5, 6_000, 1, Some(1_000));
        assert_eq!(t, "Talk of the town: a walk-out from work, works, day 5; I hold it at 6 in 10, through 1 hand. Of that, I say it is plainly wrong.");
        let h = town_words::heard(&format!("Much the same. {t} Nothing else.")).unwrap();
        assert_eq!((h.kind, h.about.as_str(), h.hops, h.says), (EventKind::Strike, "works", 1, Some(1_000)));
        assert_eq!(town_words::heard(&town_words::say(EventKind::Strike, "works", 5, 6_000, 1, None)).unwrap().says, None);
        assert_eq!(town_words::heard(&town_words::say(EventKind::PutOut, "police", 5, 6_000, 1, Some(5_000))).unwrap().says, Some(5_000));
        assert_eq!(town_words::heard(&town_words::say(EventKind::Law, "x", 5, 0, 2, None)).unwrap().strength, 1_000);
        // A failed start does not hide a later match.
        assert_eq!(town_words::heard(&format!("Talk of the town: nothing. {t}")).unwrap().day, 5);
        let mut m = mem();
        m.saw(EventKind::Strike, "works", 5 * DAY, 6 * DAY);
        let view = |_: EventKind| Some(3_000);
        assert!(m.tell("a", 7 * DAY, Some(&view)).unwrap().contains("I say it is wrong."));
        assert!(!m.tell("b", 7 * DAY, None).unwrap().contains("Of that"));
    }

    #[test]
    fn only_a_removal_and_a_walk_out_show_a_conduct_and_trust_goes_by_ones_own_view() {
        let shown: Vec<EventKind> = EVENT_KINDS.into_iter().filter(|k| event_conducts(*k).is_empty()).collect();
        assert_eq!(shown, [EventKind::Ruling, EventKind::Law, EventKind::Vote, EventKind::Founded]);
        assert_eq!(event_conducts(EventKind::PutOut)[0], event_conduct(EventKind::PutOut).unwrap());
        assert_eq!(trust_direction(EventKind::PutOut, 7_000), 1);
        assert_eq!(trust_direction(EventKind::PutOut, 3_000), -1);
        assert_eq!(trust_direction(EventKind::Strike, 7_000), -1);
        assert_eq!(trust_direction(EventKind::Strike, 3_000), 1);
        assert_eq!(trust_direction(EventKind::Strike, 5_000), 0);
        assert_eq!(trust_direction(EventKind::Law, 9_000), 0);
        assert_eq!(paper_strength(paper_weight("ballot_result").unwrap().1, &CULTURE_DEFAULTS), 5_000);
        assert_eq!(paper_strength(paper_weight("permit_decision").unwrap().1, &CULTURE_DEFAULTS), 1_250);
        assert_eq!(paper_weight("notice"), None);
    }

    #[test]
    fn sightings_are_counted_once_and_a_saved_memory_behaves_the_same() {
        let mut m = mem();
        assert!(m.new_sighting("s1|c7|100"));
        assert!(!m.new_sighting("s1|c7|100"));
        m.saw(EventKind::PutOut, "police", DAY, 2 * DAY);
        m.heard_from(EventKind::Strike, "works", 3, 4 * DAY, 7_000, 1, true);
        m.tell("a", 5 * DAY, None);
        m.section();
        let mut n: TownMemory = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(m, n);
        for x in [&mut m, &mut n] {
            x.heard_from(EventKind::PutOut, "police", 1, 50 * DAY, 9_000, 0, false);
            x.read(EventKind::Vote, "council", 40 * DAY, 50 * DAY, 4_000);
        }
        assert_eq!(m.tell("a", 60 * DAY, None), n.tell("a", 60 * DAY, None));
        assert_eq!(m.section(), n.section());
        assert_eq!(m, n);
    }
}
