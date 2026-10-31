//! participants/src/behaviour/culture.ts, in Rust (lane A2): what a town holds in common, as one person's beliefs
//! (docs/design/ai-citizens.md 14; docs/behaviour/culture.md).
//!
//! For a short closed list of conducts (each tied to one draw the code mind already makes) a person holds a picture of
//! what those around them do (`does`) and approve of (`approves`), their own view (`own`) and what they say (`says`).
//! Every figure is one person's, moved only along a tie, by being there, or by what is published (`Route`: no fourth
//! way exists). Arithmetic only: no model, no clock, no draw but a starting lean (on the person's own stream). The
//! platform judges nothing; every size is a placeholder unless the doc names a source (risks PC-2 and PC-3 stand: this
//! is a faithful port, not a fix). Sources: Bicchieri 2006 (empirical and normative expectations), Cialdini, Reno and
//! Kallgren 1990, Centola and Macy 2007 (the sighting rule), Kuran 1995 (what is said against what is thought), Kelman
//! 1958 (internalising), Ellickson, Brennan and Pettit (esteem), Williams (being left out), Cavalli-Sforza and Feldman,
//! Bisin and Verdier (parents first), Berry (acculturation).
//!
//! Decided fresh for Rust:
//! - **The environment** (TS `CultureEnv`'s closures over the citizen's mind) is a trait, `CultureEnv`, the lead
//!   implements over the mind and passes by reference to each method that reads it (`z`, `conformity`, `belonging`,
//!   `integrity`); `Standing` is a plain struct of those numbers that implements it. The starting draw (TS `env.draw`)
//!   is a separate `&mut dyn FnMut(Conduct) -> f64` given to `Culture::new` only (the one place it is called), called
//!   in the order of `CONDUCTS` for each conduct held, as TS did.
//! - **Fixed point.** `n` (the weight held) becomes fractional in TS when an event is weighed by its strength
//!   (`saw_event`): it is kept in ten-thousandths (`n_e4`), exactly, since a weight times a strength in basis points is
//!   a whole number of those. A starting lean (a standard normal, TS a float) is kept in millionths of a standard
//!   deviation (`lean0_micro`): Irwin-Hall's sum of millionths is exact there. The values' standing at a rebase
//!   (`z_start`) is kept in millionths of a standard deviation: at most 2.5e-4 bps off TS (500 bps a deviation).
//! - **Rounding** is JavaScript's `Math.round` (half up) everywhere: `math::round` on floats, `round_div` on integers;
//!   a saying's step is `floor(bps / 2000)` held to 0..4 (`div_euclid`).
//! - **Order.** Per-conduct state in `BTreeMap<Conduct, _>` (the enum's order is `CONDUCTS`' order). Where TS broke a
//!   sort tie by `a.conduct < b.conduct` (a name), it is compared by `Conduct::name()`. `of_others` keeps TS's Map
//!   insertion order explicitly (a Vec of pairs: the oldest learned gives way), `told_of` likewise (the oldest of 64
//!   gives way); sets only tested for membership are `BTreeSet`s. Gossip's tie-break compares `about + conduct` as one
//!   concatenated string, as TS did.
//! - **The section's cache.** TS reused the same array (identity) until a picture moved or `REFRESH_DAYS` passed; here
//!   `section_version()` counts the times it was worked out anew, so a caller compares versions where TS compared
//!   identity. The cache, its day and the version are saved with the rest, so a restored culture writes as before.
//! - **Routes** are an enum, so a route outside the three cannot be named; `Route::parse` refuses any other word with
//!   TS's message. `CultureDial` is not stored in `Culture` (only `p` is); `set_group` takes the dial.
//! - **Parsers** (TS regular expressions) are written by hand to the same first match; JavaScript's `\s` is
//!   `char::is_whitespace` or U+FEFF. A count too long for an i64 (19 digits and more) is no match.
//! - **Profile figures** that are not numbers, or are null, are taken as absent (TS let a null through `held`'s test).

use super::math;
use super::person::Value;
use oikos_core::rng::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};

const DAY: i64 = 86_400;

/// The conducts a world may hold, in the order the record keeps them (TS `CONDUCTS`). Closed, in code: at most 12.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Conduct {
    AnswerTribunal,
    StayPastNotice,
    TakeToTribunal,
    Complain,
    TakeIn,
    JoinUnion,
    Strike,
    TakeFromEmployer,
    // (An organisation's own conducts: a person holds a view of them.)
    ApplyPossession,
    HeadsBeforeHours,
    OrderPossession,
}

/// TS `CONDUCTS`, in order.
pub const CONDUCTS: [Conduct; 11] = [
    Conduct::AnswerTribunal,
    Conduct::StayPastNotice,
    Conduct::TakeToTribunal,
    Conduct::Complain,
    Conduct::TakeIn,
    Conduct::JoinUnion,
    Conduct::Strike,
    Conduct::TakeFromEmployer,
    Conduct::ApplyPossession,
    Conduct::HeadsBeforeHours,
    Conduct::OrderPossession,
];
pub const MAX_CONDUCTS: usize = 12;
/// The conducts a person makes a choice about today: each has a draw, and takes a term there.
pub const PERSONS_CONDUCTS: [Conduct; 8] = [
    Conduct::AnswerTribunal,
    Conduct::StayPastNotice,
    Conduct::TakeToTribunal,
    Conduct::Complain,
    Conduct::TakeIn,
    Conduct::JoinUnion,
    Conduct::Strike,
    Conduct::TakeFromEmployer,
];

impl Conduct {
    pub fn name(self) -> &'static str {
        match self {
            Conduct::AnswerTribunal => "answer_tribunal",
            Conduct::StayPastNotice => "stay_past_notice",
            Conduct::TakeToTribunal => "take_to_tribunal",
            Conduct::Complain => "complain",
            Conduct::TakeIn => "take_in",
            Conduct::JoinUnion => "join_union",
            Conduct::Strike => "strike",
            Conduct::TakeFromEmployer => "take_from_employer",
            Conduct::ApplyPossession => "apply_possession",
            Conduct::HeadsBeforeHours => "heads_before_hours",
            Conduct::OrderPossession => "order_possession",
        }
    }
    pub fn from_name(s: &str) -> Option<Conduct> {
        CONDUCTS.into_iter().find(|c| c.name() == s)
    }
    /// The place in `CONDUCTS` (the record's position).
    pub fn index(self) -> usize {
        self as usize
    }
}

/// Words for a conduct, in the world's terms (TS `WORDS`): the occasion, doing it and not, and the thing done.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Words {
    pub occasion: &'static str,
    pub did: &'static str,
    pub did_not: &'static str,
    pub thing: &'static str,
}
const WORDS_TABLE: [Words; 8] = [
    Words { occasion: "Served with an application for possession", did: "I answered it", did_not: "I did not answer it", thing: "answering an application for possession" },
    Words { occasion: "Told to vacate and unable to pay", did: "I was still there at the date", did_not: "I left by the date", thing: "staying past a notice to vacate" },
    Words { occasion: "Wronged by an unlawful rent rise or an unpaid debt", did: "I applied to the tribunal", did_not: "I did not apply", thing: "applying to the tribunal" },
    Words { occasion: "When a service failed", did: "I wrote to the town", did_not: "I did not write", thing: "writing to the town about a service" },
    Words { occasion: "Asked for a roof by someone known", did: "I said yes", did_not: "I said no", thing: "taking in someone who asks for a roof" },
    Words { occasion: "At a new job", did: "I joined the union", did_not: "I did not join", thing: "joining the union" },
    Words { occasion: "Balloted on action", did: "I voted yes", did_not: "I voted no", thing: "voting for action" },
    Words { occasion: "Short of money at work among goods", did: "I took some", did_not: "I took nothing", thing: "taking goods from an employer" },
];
/// The same acts in the third person (TS `THEY`): did, did not.
const THEY_TABLE: [(&str, &str); 8] = [
    ("they answered it", "they did not answer it"),
    ("they were still there at the date", "they left by the date"),
    ("they applied to the tribunal", "they did not apply"),
    ("they wrote to the town", "they did not write"),
    ("they said yes", "they said no"),
    ("they joined the union", "they did not join"),
    ("they voted yes", "they voted no"),
    ("they took some", "they took nothing"),
];
/// TS `WORDS[c]`: a person's own conducts have words; an organisation's have none.
pub fn words(c: Conduct) -> Option<&'static Words> {
    WORDS_TABLE.get(c.index())
}
/// TS `THEY[c]`: (did, did not).
pub fn they(c: Conduct) -> Option<(&'static str, &'static str)> {
    THEY_TABLE.get(c.index()).copied()
}

/// What is said of a conduct, in five steps, and the middle of each (basis points).
pub const SAYINGS: [(&str, i64); 5] = [("plainly wrong", 1_000), ("wrong", 3_000), ("neither right nor wrong", 5_000), ("right", 7_000), ("plainly right", 9_000)];

/// The saying for a figure: its step, `floor(bps / 2000)` held to 0..4.
pub fn saying(bps: i64) -> &'static str {
    SAYINGS[bps.div_euclid(2_000).clamp(0, 4) as usize].0
}

/// JavaScript's `Math.round(x / d)` for an integer `x` and `d > 0`, exactly.
pub fn round_div(x: i64, d: i64) -> i64 {
    (2 * x + d).div_euclid(2 * d)
}

/// JavaScript's `\s`.
fn js_space(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{feff}'
}

/// Leading ASCII digits (at least one), parsed; and the rest.
fn digits(s: &str) -> Option<(i64, &str)> {
    let n = s.bytes().take_while(|b| b.is_ascii_digit()).count();
    if n == 0 {
        return None;
    }
    Some((s[..n].parse().ok()?, &s[n..]))
}

/// Every start of `pat` in `text`, overlapping ones too (as a regular expression tries each position).
fn starts<'a>(text: &'a str, pat: &'a str) -> impl Iterator<Item = usize> + 'a {
    let mut from = 0;
    std::iter::from_fn(move || {
        let at = from + text.get(from..)?.find(pat)?;
        from = at + text[at..].chars().next().map_or(1, char::len_utf8);
        Some(at)
    })
}

/// A conduct done or not, as a phrase tells.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DidHeard {
    pub conduct: Conduct,
    pub did: bool,
}
/// What is said of a conduct, as a phrase tells (a step's middle).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaysHeard {
    pub conduct: Conduct,
    pub bps: i64,
}
/// TS `CULTURE_WORDS.heard`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Heard {
    pub did: Vec<DidHeard>,
    pub says: Vec<SaysHeard>,
}
/// TS `CULTURE_WORDS.verdictHeard`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerdictHeard {
    pub conduct: Conduct,
    pub did: bool,
    pub approval: i64,
}
/// TS `CULTURE_WORDS.aboutHeard`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AboutHeard {
    pub who: String,
    pub conduct: Conduct,
    pub did: bool,
    pub approval: i64,
}
/// A conduct's picture as a parent tells it, or as a person holds it (TS `{ conduct, does, approves }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HouseholdRow {
    pub conduct: Conduct,
    pub does: i64,
    pub approves: i64,
}

/// TS `CULTURE_WORDS`: how a person says what they did and what they say of it, and the parsers of those phrases. A code
/// person's phrasing, understood only in this phrasing; byte for byte TS's.
pub mod culture_words {
    use super::*;

    /// "<occasion>: <did or did not>." ("" for a conduct without words).
    pub fn did(c: Conduct, did: bool) -> String {
        words(c).map_or(String::new(), |w| format!("{}: {}.", w.occasion, if did { w.did } else { w.did_not }))
    }
    /// "I say <thing> is <saying>."
    pub fn says(c: Conduct, says: i64) -> String {
        words(c).map_or(String::new(), |w| format!("I say {} is {}.", w.thing, saying(says)))
    }
    /// What a phrase tells: the conducts done or not, and what is said of them (a step's middle).
    pub fn heard(text: &str) -> Option<Heard> {
        let (mut did, mut says) = (vec![], vec![]);
        for c in PERSONS_CONDUCTS {
            let w = words(c).unwrap();
            if text.contains(&format!("{}: {}.", w.occasion, w.did)) {
                did.push(DidHeard { conduct: c, did: true });
            } else if text.contains(&format!("{}: {}.", w.occasion, w.did_not)) {
                did.push(DidHeard { conduct: c, did: false });
            }
            for (s, mid) in SAYINGS {
                if text.contains(&format!("I say {} is {}.", w.thing, s)) {
                    says.push(SaysHeard { conduct: c, bps: mid });
                }
            }
        }
        if did.is_empty() && says.is_empty() {
            None
        } else {
            Some(Heard { did, says })
        }
    }
    /// What I say to someone of what they did: "Of your [not ]<thing>: I say it is <saying>."
    pub fn verdict(c: Conduct, did: bool, approval_bps: i64) -> String {
        words(c).map_or(String::new(), |w| format!("Of your {}{}: I say it is {}.", if did { "" } else { "not " }, w.thing, saying(approval_bps)))
    }
    /// What a verdict tells (the whole text must be one).
    pub fn verdict_heard(text: &str) -> Option<VerdictHeard> {
        for c in PERSONS_CONDUCTS {
            let w = words(c).unwrap();
            for did in [true, false] {
                for (s, mid) in SAYINGS {
                    if text == format!("Of your {}{}: I say it is {}.", if did { "" } else { "not " }, w.thing, s) {
                        return Some(VerdictHeard { conduct: c, did, approval: mid });
                    }
                }
            }
        }
        None
    }
    /// What I tell of someone else's act: "About <who>: <occasion>: <they did or not>. Of that, I say it is <saying>."
    pub fn about(who: &str, c: Conduct, did: bool, approval_bps: i64) -> String {
        match (words(c), they(c)) {
            (Some(w), Some(th)) => format!("About {who}: {}: {}. Of that, I say it is {}.", w.occasion, if did { th.0 } else { th.1 }, saying(approval_bps)),
            _ => String::new(),
        }
    }
    /// What such a phrase tells (found anywhere in a message): of whom (no space in it), the conduct, whether, and the teller's judgement.
    pub fn about_heard(text: &str) -> Option<AboutHeard> {
        for c in PERSONS_CONDUCTS {
            let (w, th) = (words(c).unwrap(), they(c).unwrap());
            for did in [true, false] {
                for (s, mid) in SAYINGS {
                    let tail = format!(": {}: {}. Of that, I say it is {}.", w.occasion, if did { th.0 } else { th.1 }, s);
                    let Some(at) = text.find(&tail) else { continue };
                    // (TS `lastIndexOf("About ", at)`: no "About " can overlap the tail, which begins with ':'.)
                    let Some(head) = text[..at].rfind("About ") else { continue };
                    let who = &text[head + 6..at];
                    if !who.is_empty() && !who.chars().any(js_space) {
                        return Some(AboutHeard { who: who.to_string(), conduct: c, did, approval: mid });
                    }
                }
            }
        }
        None
    }
    /// What a parent tells a child who asks: "As I see it, of <thing>: <d> in 10 do it, <a> in 10 would call it right."
    pub fn household(c: Conduct, does_bps: i64, approves_bps: i64) -> String {
        words(c).map_or(String::new(), |w| {
            format!("As I see it, of {}: {} in 10 do it, {} in 10 would call it right.", w.thing, round_div(does_bps, 1_000), round_div(approves_bps, 1_000))
        })
    }
    /// What such phrases tell, one row for each conduct found (its first telling).
    pub fn household_heard(text: &str) -> Vec<HouseholdRow> {
        let mut out = vec![];
        for c in PERSONS_CONDUCTS {
            let prefix = format!("As I see it, of {}: ", words(c).unwrap().thing);
            for at in starts(text, &prefix) {
                let rest = &text[at + prefix.len()..];
                let Some((d, rest)) = digits(rest) else { continue };
                let Some(rest) = rest.strip_prefix(" in 10 do it, ") else { continue };
                let Some((a, rest)) = digits(rest) else { continue };
                if rest.starts_with(" in 10 would call it right.") {
                    out.push(HouseholdRow { conduct: c, does: d * 1_000, approves: a * 1_000 });
                    break;
                }
            }
        }
        out
    }
    /// Where a person comes from: "I come from the <group> group."
    pub fn from(group: &str) -> String {
        format!("I come from the {group} group.")
    }
    /// TS `/I come from the ([^\s.]+) group\./`.
    pub fn from_heard(text: &str) -> Option<String> {
        const P: &str = "I come from the ";
        for at in starts(text, P) {
            let rest = &text[at + P.len()..];
            let n: usize = rest.chars().take_while(|&ch| !js_space(ch) && ch != '.').map(char::len_utf8).sum();
            if n > 0 && rest[n..].starts_with(" group.") {
                return Some(rest[..n].to_string());
            }
        }
        None
    }
}

/// Which values speak to a conduct, and which way (ours, to test against data): a signed list (TS `VALUE_MAP`).
pub fn value_map(c: Conduct) -> &'static [(Value, i64)] {
    use Value::*;
    match c {
        Conduct::AnswerTribunal => &[(Conformity, 1), (Security, 1)],
        Conduct::StayPastNotice => &[(Security, 1), (Conformity, -1)],
        Conduct::TakeToTribunal => &[(SelfDirection, 1), (Universalism, 1)],
        Conduct::Complain => &[(SelfDirection, 1), (Universalism, 1), (Conformity, -1)],
        Conduct::TakeIn => &[(Benevolence, 1), (Tradition, 1)],
        Conduct::JoinUnion => &[(Universalism, 1), (Benevolence, 1), (Power, -1)],
        Conduct::Strike => &[(Universalism, 1), (Benevolence, 1), (Security, -1)],
        Conduct::TakeFromEmployer => &[(Conformity, -1), (Tradition, -1), (Hedonism, 1)],
        Conduct::ApplyPossession => &[(Power, 1), (Security, 1), (Benevolence, -1)],
        Conduct::HeadsBeforeHours => &[(Achievement, 1), (Benevolence, -1)],
        Conduct::OrderPossession => &[(Conformity, 1), (Security, 1)],
    }
}

macro_rules! culture_params {
    ($( $(#[$doc:meta])* $name:ident : $def:expr ),* $(,)?) => {
        /// The sizes (docs/behaviour/culture.md; every one a placeholder unless the doc names a source). JSON keys as TS's.
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        pub struct CultureParams { $( $(#[$doc])* pub $name: i64, )* }
        /// TS `CULTURE_DEFAULTS`.
        pub const CULTURE_DEFAULTS: CultureParams = CultureParams { $( $name: $def, )* };
        /// The keys in the order of TS's defaults (the order the checks run in).
        const PARAM_KEYS: &[&str] = &[ $( stringify!($name), )* ];
    };
}

culture_params! {
    /// Weight of the picture a person starts with (as if this many had been seen).
    prior_weight: 4,
    /// The spread of the lean a person starts with.
    own_sd_bps: 1_500,
    /// The movement per standard deviation of the values that speak to a conduct.
    values_bps: 500,
    /// What is seen is held to this much weight: the recent counts for more.
    window: 20,
    /// A sighting's weight: someone known.
    known_weight: 1,
    /// A close tie.
    close_weight: 2,
    /// A published count (up to).
    published_weight: 4,
    /// A tie is close at this affinity.
    close_affinity_bps: 3_000,
    /// `own` settles half the way to `approves` in this many days.
    internalise_days: 1_095,
    /// The cost of standing out against the cost of saying what one does not think, in thousandths (Kuran 1995).
    reputation_scale_milli: 1_000,
    /// The chance that, asked how things are, I also tell of one other person's conduct I know first-hand of.
    gossip_bps: 3_000,
    /// I tell of an act for this many days after I heard it.
    gossip_days: 180,
    /// The most people whose acts I keep to tell of.
    third_kept: 8,
    /// The standard deviation of the decision term.
    sd_bps: 2_500,
    /// The weight of what is done in the term.
    w_does_bps: 6_000,
    /// The weight of what is approved in the term.
    w_approves_bps: 4_000,
    /// The sway of a lean on a rate: thousandths of the rate per standard deviation.
    sway_milli: 300,
    /// One's own conduct is told only if it sits within this of what one takes to be approved.
    conceal_bps: 7_500,
    /// An integrity above this tells whatever it is.
    integrity_tells_bps: 7_000,
    /// The record's grain, whole percent.
    grain_percent: 2,
    /// Placeholder for what is approved where the profile is silent.
    approves_default_bps: 5_000,
    /// Placeholder for what is done, for a conduct with no rate of its own and no figure.
    does_default_bps: 5_000,
    /// Most phrases a person adds when asked how things are.
    phrases: 3,
    /// An act told by a tie sits with what I think of it by more than this before I feel or say anything of it.
    margin_bps: 2_500,
    /// A tie cools by at most this toward whoever did what I hold against.
    cool_bps: 500,
    /// And warms by at most this toward whoever did what I hold with.
    esteem_bps: 200,
    /// Told it is held against me: a dent to belonging of at most this, times a half to one and a half by conformity.
    disapproved_bps: 300,
    /// A newcomer holds the profile's picture at this weight.
    newcomer_weight: 1,
    /// The points a standard deviation of the lean adds to a way a want may take.
    way_points: 1_500,
    /// Town memory: the most events a person holds.
    slots: 6,
    /// How strongly an event first reaches me, seen.
    seen_bps: 10_000,
    /// Read (the paper's heaviest item).
    read_bps: 5_000,
    /// Told: this share of the teller's strength.
    pass_bps: 6_000,
    /// And this much more for what I hold against.
    negative_bps: 2_000,
    /// An event told through more hands than this is not kept.
    max_hops: 3,
    /// A strength halves in this many days, seen.
    half_life_seen_days: 365,
    /// Read or told.
    half_life_told_days: 180,
    /// I tell what I hold above this strength.
    tell_at_bps: 2_000,
    /// Hearing it again returns this share of the way to what it first was.
    rehearse_bps: 3_000,
    /// An event bears on trust in whoever did it at its strength times this.
    bystander_bps: 5_000,
    /// A departure found in a building I am in counts as seen if no older than this.
    witness_days: 3,
    /// An office's practice is counted over this many days.
    practice_window_days: 1_825,
    /// Below this many occasions an office's habit is not yet one.
    practice_min_occasions: 5,
    /// A code holder's rate is drawn this much of the way toward its own practice.
    practice_inertia_bps: 5_000,
    /// An office opens with a past of this many occasions.
    practice_opening: 100,
}

impl Default for CultureParams {
    fn default() -> Self {
        CULTURE_DEFAULTS
    }
}

const SHARES: [&str; 22] = [
    "own_sd_bps", "values_bps", "w_does_bps", "w_approves_bps", "close_affinity_bps", "conceal_bps", "integrity_tells_bps", "approves_default_bps", "does_default_bps", "margin_bps", "cool_bps",
    "esteem_bps", "gossip_bps", "disapproved_bps", "seen_bps", "read_bps", "pass_bps", "negative_bps", "tell_at_bps", "rehearse_bps", "bystander_bps", "practice_inertia_bps",
];
const AT_LEAST_ONE: [&str; 17] = [
    "prior_weight", "window", "known_weight", "close_weight", "published_weight", "internalise_days", "sd_bps", "newcomer_weight", "slots", "half_life_seen_days", "half_life_told_days",
    "witness_days", "gossip_days", "third_kept", "practice_window_days", "practice_min_occasions", "practice_opening",
];

/// JavaScript's `Number.isInteger`, as an i64.
fn js_integer(v: &Json) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().filter(|x| x.is_finite() && x.fract() == 0.0 && x.abs() < 9.2e18).map(|x| x as i64))
}

fn shown(v: &Json) -> String {
    match v {
        Json::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// TS `cultureParams(given)`: the sizes the world gives, over the defaults, refusing any that would break the arithmetic.
pub fn culture_params(given: &Json) -> Result<CultureParams, String> {
    let Json::Object(mut merged) = serde_json::to_value(CULTURE_DEFAULTS).expect("params serialise") else { unreachable!() };
    if let Json::Object(g) = given {
        for (k, v) in g {
            merged.insert(k.clone(), v.clone());
        }
    }
    for k in PARAM_KEYS {
        let v = &merged[*k];
        match js_integer(v) {
            Some(x) if x >= 0 => {
                merged.insert(k.to_string(), Json::from(x));
            }
            _ => return Err(format!("dials.culture.step.{k}: a size is a whole number, not below 0; got {}", shown(v))),
        }
    }
    let get = |k: &str| merged[k].as_i64().unwrap_or(0);
    for k in SHARES {
        if get(k) > 10_000 {
            return Err(format!("dials.culture.step.{k}: a share is from 0 to 10000; got {}", get(k)));
        }
    }
    for k in AT_LEAST_ONE {
        if get(k) < 1 {
            return Err(format!("dials.culture.step.{k}: must be at least 1; got {}", get(k)));
        }
    }
    let p: CultureParams = serde_json::from_value(Json::Object(merged)).map_err(|e| e.to_string())?;
    if p.window < p.prior_weight || p.window < p.published_weight {
        return Err("dials.culture.step.window: must hold the prior's and a published count's weight".into());
    }
    if p.sway_milli > 1_000 {
        return Err(format!("dials.culture.step.sway_milli: a lean may move a rate by at most the whole of it per standard deviation; got {}", p.sway_milli));
    }
    if p.slots > 12 {
        return Err(format!("dials.culture.step.slots: at most 12 events held; got {}", p.slots));
    }
    if p.max_hops > 8 {
        return Err(format!("dials.culture.step.max_hops: at most 8 hands; got {}", p.max_hops));
    }
    if p.way_points > 10_000 {
        return Err(format!("dials.culture.step.way_points: at most 10000 a standard deviation; got {}", p.way_points));
    }
    if p.phrases > 6 {
        return Err(format!("dials.culture.step.phrases: at most 6 phrases a time; got {}", p.phrases));
    }
    Ok(p)
}

/// The profile's figures for a conduct: what is done and what is approved, in basis points, either may be absent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConductFigures {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub does_bps: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approves_bps: Option<i64>,
}

/// An origin group and its share of the people (basis points).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OriginShare {
    pub id: String,
    pub share_bps: i64,
}

/// The dial as the world carries it (TS `CultureDial`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CultureDial {
    pub conducts: Vec<Conduct>,
    pub params: std::sync::Arc<CultureParams>,
    /// The profile's figures by conduct name.
    pub figures: BTreeMap<String, ConductFigures>,
    /// By origin group (a group's figures replace the profile's for those who come from it).
    #[serde(rename = "byOrigin")]
    pub by_origin: BTreeMap<String, BTreeMap<String, ConductFigures>>,
    pub homophily_bps: i64,
    pub shares: Vec<OriginShare>,
}

fn figure(v: Option<&Json>) -> Option<i64> {
    v.and_then(Json::as_f64).map(math::round)
}
fn figures_of(v: Option<&Json>) -> BTreeMap<String, ConductFigures> {
    let mut out = BTreeMap::new();
    if let Some(Json::Object(m)) = v {
        for (k, f) in m {
            out.insert(k.clone(), ConductFigures { does_bps: figure(f.get("does_bps")), approves_bps: figure(f.get("approves_bps")) });
        }
    }
    out
}

/// TS `cultureDial(world)`, given the world's `dials`: None where the culture dial is off.
pub fn culture_dial(dials: &Json) -> Result<Option<CultureDial>, String> {
    let Some(d) = dials.get("culture").filter(|d| d.is_object() || d.is_array()) else { return Ok(None) };
    let conducts = match d.get("conducts") {
        Some(Json::Array(list)) => {
            let mut out = vec![];
            for c in list {
                match c.as_str().and_then(Conduct::from_name) {
                    Some(c) => out.push(c),
                    None => return Err(format!("dials.culture.conducts: {} is not a conduct the build knows", shown(c))),
                }
            }
            out
        }
        _ => CONDUCTS.to_vec(),
    };
    if conducts.len() > MAX_CONDUCTS {
        return Err(format!("dials.culture.conducts: at most {MAX_CONDUCTS}"));
    }
    let mut step = match d.get("step") {
        Some(Json::Object(m)) => m.clone(),
        _ => serde_json::Map::new(),
    };
    if let Some(s) = d.get("sway_milli").and_then(js_integer) {
        step.insert("sway_milli".into(), Json::from(s));
    }
    let params = culture_params(&Json::Object(step))?;
    let profile = d.get("profile");
    let mut by_origin = BTreeMap::new();
    if let Some(Json::Object(m)) = profile.and_then(|p| p.get("by_origin")) {
        for (g, f) in m {
            by_origin.insert(g.clone(), figures_of(Some(f)));
        }
    }
    let shares = match profile.and_then(|p| p.get("origin_shares")) {
        Some(Json::Array(list)) => list
            .iter()
            .map(|s| OriginShare { id: s.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string(), share_bps: s.get("share_bps").and_then(js_integer).unwrap_or(0) })
            .collect(),
        _ => vec![],
    };
    Ok(Some(CultureDial {
        conducts,
        params: std::sync::Arc::new(params),
        figures: figures_of(profile.and_then(|p| p.get("conducts"))),
        by_origin,
        homophily_bps: profile.and_then(|p| p.get("homophily_bps")).and_then(js_integer).unwrap_or(0),
        shares,
    }))
}

/// How a person's own situation reaches the arithmetic at the moment of a call (TS `CultureEnv`, less `draw`). The lead
/// implements it over the citizen's mind.
pub trait CultureEnv {
    /// A value's standing against the town's, in standard deviations (-3..3).
    fn z(&self, v: Value) -> f64;
    /// Conformity, 0..1.
    fn conformity(&self) -> f64;
    /// Belonging's weight, 0..1.
    fn belonging(&self) -> f64;
    /// Integrity, 0..1.
    fn integrity(&self) -> f64;
}

/// The numbers a culture reads, as plain figures (a `CultureEnv` for a caller that has them at hand, and for tests).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Standing {
    pub z: [f64; 10],
    pub conformity: f64,
    pub belonging: f64,
    pub integrity: f64,
}
impl CultureEnv for Standing {
    fn z(&self, v: Value) -> f64 {
        self.z[v.index()]
    }
    fn conformity(&self) -> f64 {
        self.conformity
    }
    fn belonging(&self) -> f64 {
        self.belonging
    }
    fn integrity(&self) -> f64 {
        self.integrity
    }
}

/// The ways a person may learn what others do; nothing else moves a picture (docs/no-god-view.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    Tie,
    CloseTie,
    Here,
    Published,
}
pub const ROUTES: [Route; 4] = [Route::Tie, Route::CloseTie, Route::Here, Route::Published];
impl Route {
    pub fn name(self) -> &'static str {
        match self {
            Route::Tie => "tie",
            Route::CloseTie => "close_tie",
            Route::Here => "here",
            Route::Published => "published",
        }
    }
    /// A route by its word; any other word is refused (TS `Culture.weight`'s refusal).
    pub fn parse(s: &str) -> Result<Route, String> {
        ROUTES.into_iter().find(|r| r.name() == s).ok_or_else(|| {
            format!("culture: a picture of what others do is moved only along a tie, by being there, or by what is published; not by \"{s}\" (docs/no-god-view.md)")
        })
    }
}

/// A conduct's five numbers in the record: [does, approves, own, says, n].
pub type NormsRow = [i64; 5];
/// The record's `norms`: one place for each conduct of `CONDUCTS`, in order, None where the person holds none.
pub type NormsSection = Vec<Option<NormsRow>>;
/// The record's norms as named rows.
pub fn norms_rows(section: &[Option<NormsRow>]) -> Vec<(Conduct, NormsRow)> {
    section.iter().enumerate().filter_map(|(i, r)| r.map(|r| (CONDUCTS[i], r))).collect()
}

/// What I feel for a tie whose act was told to me (basis points on the tie) and, if I would say something, how I judge it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reaction {
    pub tie: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<i64>,
}

/// The four numbers and the weight held for a conduct (TS `read`'s answer); `n_e4` is the weight in ten-thousandths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reading {
    pub does: i64,
    pub approves: i64,
    pub own: i64,
    pub says: i64,
    pub n_e4: i64,
}

/// A recorded decision's `norm` (whole percent; the lean in hundredths of a standard deviation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Norm {
    pub conduct: Conduct,
    pub does: i64,
    pub approves: i64,
    pub own: i64,
    pub says: i64,
    pub lean: i64,
}

/// What a person holds of one conduct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Row {
    does: i64,
    approves: i64,
    own_base: i64,
    /// Seconds.
    own_at: i64,
    /// The values' standing at the last (re)start, millionths of a standard deviation.
    z_start_micro: i64,
    /// The weight held, ten-thousandths.
    n_e4: i64,
    /// The profile's figures: the point the lean is measured from.
    does0: i64,
    approves0: i64,
    /// The person's starting lean (a standard normal), millionths.
    lean0_micro: i64,
}

/// My own act at an occasion, or one I heard of, kept to be told: to whom already told.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Act {
    did: bool,
    t: i64,
    told: BTreeSet<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct HeardOf {
    t: i64,
    told: BTreeSet<String>,
}

const E4: i64 = 10_000;
const MICRO: f64 = 1_000_000.0;

/// One person's norms (TS `Culture`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Culture {
    pub p: std::sync::Arc<CultureParams>,
    /// The conducts held, in `CONDUCTS`' order.
    pub held: Vec<Conduct>,
    rows: BTreeMap<Conduct, Row>,
    acts: BTreeMap<Conduct, Act>,
    heard_of: BTreeMap<Conduct, HeardOf>,
    origin: Option<String>,
    /// Others' acts a tie told me of, by who, in the order learned (the oldest gives way).
    of_others: Vec<(String, BTreeMap<Conduct, Act>)>,
    /// Acts told me of someone else, in the order told (at most 64), so none is counted twice.
    told_of: Vec<String>,
    cached: Option<NormsSection>,
    cached_at: i64,
    dirty: bool,
    version: u64,
}

fn sd(z: f64) -> f64 {
    z.clamp(-3.0, 3.0)
}

impl Culture {
    /// `rates`: the conducts this person has a rate for in their world, and the rate; `group`: their origin group.
    /// `draw` gives a starting lean for each conduct held (a standard normal on the person's own stream), in order.
    pub fn new(
        p: impl Into<std::sync::Arc<CultureParams>>,
        dial: &CultureDial,
        env: &dyn CultureEnv,
        draw: &mut dyn FnMut(Conduct) -> f64,
        rates: &BTreeMap<Conduct, i64>,
        group: Option<&str>,
        t: i64,
    ) -> Culture {
        let p = p.into();
        let mut c = Culture {
            p,
            held: vec![],
            rows: BTreeMap::new(),
            acts: BTreeMap::new(),
            heard_of: BTreeMap::new(),
            origin: group.map(str::to_string),
            of_others: vec![],
            told_of: vec![],
            cached: None,
            cached_at: 0,
            dirty: true,
            version: 0,
        };
        let none = ConductFigures::default();
        for k in CONDUCTS {
            if !dial.conducts.contains(&k) {
                continue;
            }
            let fig = dial.figures.get(k.name()).unwrap_or(&none);
            let grp = group.and_then(|g| dial.by_origin.get(g)).and_then(|m| m.get(k.name())).unwrap_or(&none);
            // A conduct is held where the world gives it a rate or the profile gives a figure for it.
            if rates.get(&k).is_none() && fig.does_bps.is_none() && fig.approves_bps.is_none() && grp.does_bps.is_none() {
                continue;
            }
            c.held.push(k);
            let does0 = fig.does_bps.or(rates.get(&k).copied()).unwrap_or(c.p.does_default_bps);
            let approves0 = fig.approves_bps.unwrap_or(c.p.approves_default_bps);
            let approves = grp.approves_bps.unwrap_or(approves0).clamp(0, 10_000);
            let z = z_of(env, k);
            let lean = draw(k);
            c.rows.insert(
                k,
                Row {
                    does: grp.does_bps.unwrap_or(does0).clamp(0, 10_000),
                    approves,
                    own_base: math::clamp_bps(approves as f64 + c.p.own_sd_bps as f64 * lean + c.p.values_bps as f64 * z),
                    own_at: t,
                    z_start_micro: math::round(z * MICRO),
                    n_e4: c.p.prior_weight * E4,
                    does0: does0.clamp(0, 10_000),
                    approves0: approves0.clamp(0, 10_000),
                    lean0_micro: math::round(lean * MICRO),
                },
            );
        }
        c
    }

    /// Where I come from, if the world has groups and I know.
    pub fn group(&self) -> Option<&str> {
        self.origin.as_deref()
    }
    pub fn has(&self, c: Conduct) -> bool {
        self.rows.contains_key(&c)
    }

    /// What I think myself: my starting lean and the values as they have moved since, settling toward what I take to be
    /// approved (worked out when read, from the days gone).
    fn own(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> i64 {
        let r = &self.rows[&c];
        let keep = math::halved((t - r.own_at).max(0) as f64 / DAY as f64, self.p.internalise_days as f64);
        let settled = r.approves as f64 + (r.own_base - r.approves) as f64 * keep;
        math::clamp_bps(settled + self.p.values_bps as f64 * (z_of(env, c) - r.z_start_micro as f64 / MICRO))
    }
    /// The share of the way from what I think to what I take the street to approve that I go in what I say, 0..1
    /// (Kuran 1995): `reputation / (reputation + integrity)`, reputation `scale/1000 x belonging x conformity`.
    pub fn pressure(&self, env: &dyn CultureEnv) -> f64 {
        let rep = (self.p.reputation_scale_milli as f64 / 1_000.0) * env.belonging() * env.conformity();
        let inner = env.integrity();
        if rep + inner > 0.0 {
            rep / (rep + inner)
        } else {
            0.0
        }
    }
    /// What I say when asked: what I think, moved toward what I take to be approved by `pressure` of the way.
    fn says(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> i64 {
        let own = self.own(env, c, t);
        math::clamp_bps(own as f64 + self.pressure(env) * (self.rows[&c].approves - own) as f64)
    }

    /// The four numbers and the weight held for a conduct, as of `t`.
    pub fn read(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> Option<Reading> {
        let r = self.rows.get(&c)?;
        Some(Reading { does: r.does, approves: r.approves, own: self.own(env, c, t), says: self.says(env, c, t), n_e4: r.n_e4 })
    }

    /// The lean at a conduct's decision, in standard deviations (-3..3; a float for the one computation it enters).
    pub fn lean(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> f64 {
        let Some(r) = self.rows.get(&c) else { return 0.0 };
        let (k, p) = (env.conformity(), &self.p);
        let street = (p.w_does_bps * (r.does - r.does0) + p.w_approves_bps * (r.approves - r.approves0)) as f64 / 10_000.0;
        sd((k * street + (1.0 - k) * (self.own(env, c, t) - r.approves0) as f64) / p.sd_bps as f64)
    }
    /// A rate (basis points) as this person's lean sways it; `sign` 1 or -1.
    pub fn term(&self, env: &dyn CultureEnv, bps: i64, c: Conduct, t: i64, sign: i64) -> i64 {
        math::clamp_bps(bps as f64 * (1.0 + (self.p.sway_milli as f64 / 1_000.0) * sign as f64 * self.lean(env, c, t)))
    }
    /// The numbers and the lean for a recorded decision's `norm`.
    pub fn norm(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> Option<Norm> {
        let r = self.read(env, c, t)?;
        Some(Norm {
            conduct: c,
            does: round_div(r.does, 100),
            approves: round_div(r.approves, 100),
            own: round_div(r.own, 100),
            says: round_div(r.says, 100),
            lean: math::round(self.lean(env, c, t) * 100.0),
        })
    }
    /// The same as whole integers for an outcome's facts (`norm_does`, ...); empty where not held.
    pub fn facts(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> BTreeMap<String, i64> {
        let mut out = BTreeMap::new();
        if let Some(n) = self.norm(env, c, t) {
            for (k, v) in [("norm_does", n.does), ("norm_approves", n.approves), ("norm_own", n.own), ("norm_says", n.says), ("norm_lean", n.lean)] {
                out.insert(k.to_string(), v);
            }
        }
        out
    }

    // ------------------------------------------------------------ learning what others do

    /// How much a sighting weighs by the way it came.
    pub fn weight(&self, route: Route) -> i64 {
        match route {
            Route::Published => self.p.published_weight,
            Route::CloseTie => self.p.close_weight,
            Route::Tie | Route::Here => self.p.known_weight,
        }
    }
    /// Saw one person do it, or not (a tie told me, or I was there).
    pub fn see_act(&mut self, c: Conduct, did: bool, route: Route) {
        let w = self.weight(route) * E4;
        self.move_does(c, if did { 10_000 } else { 0 }, w);
    }
    /// A published count: the share who did it, of those who met the occasion (TS's default route is `Published`).
    pub fn see_share(&mut self, c: Conduct, share_bps: i64, route: Route) {
        let w = self.weight(route) * E4;
        self.move_does(c, share_bps.clamp(0, 10_000), w);
    }
    /// `does += (x - does) * w / n'`, `n' = min(window, n + w)`; `w_e4` in ten-thousandths.
    fn move_does(&mut self, c: Conduct, x: i64, w_e4: i64) {
        let window = self.p.window * E4;
        let Some(r) = self.rows.get_mut(&c) else { return };
        let held = window.min(r.n_e4 + w_e4);
        r.does = math::clamp_bps(r.does as f64 + ((x - r.does) * w_e4) as f64 / held as f64);
        r.n_e4 = held;
        self.dirty = true;
    }
    /// A public event that is an instance of `c` became mine: one more sighting of `c` done at the route's weight times
    /// its strength, and, where the teller said what they think of it, one hearing of that at the same weight.
    pub fn saw_event(&mut self, c: Conduct, route: Route, strength_bps: i64, said_bps: Option<i64>) {
        if !self.has(c) {
            return;
        }
        let scale = strength_bps.clamp(0, 10_000);
        let w = self.weight(route) * scale;
        self.move_does(c, 10_000, w);
        if let Some(s) = said_bps {
            self.hear_said_e4(c, s, w);
        }
    }
    /// Heard what someone says of it: the same rule on `approves`, weighted `w / (n + w)`.
    pub fn hear_said(&mut self, c: Conduct, bps: i64, route: Route) {
        let w = self.weight(route) * E4;
        self.hear_said_e4(c, bps, w);
    }
    fn hear_said_e4(&mut self, c: Conduct, bps: i64, w_e4: i64) {
        let Some(r) = self.rows.get_mut(&c) else { return };
        r.approves = math::clamp_bps(r.approves as f64 + ((bps.clamp(0, 10_000) - r.approves) * w_e4) as f64 / (r.n_e4 + w_e4) as f64);
        self.dirty = true;
    }

    // ------------------------------------------------------------ telling

    /// My own act at an occasion: kept to be told.
    pub fn act(&mut self, c: Conduct, did: bool, t: i64) {
        if self.has(c) {
            self.acts.insert(c, Act { did, t, told: BTreeSet::new() });
        }
    }
    /// What I say when asked how things are, to `asker`: my recent acts (not those I would rather keep back, none twice to
    /// the same person) and what I say of them; then what I say of what I was told of lately.
    pub fn tell(&mut self, env: &dyn CultureEnv, asker: &str, t: i64, news_days: i64) -> Vec<String> {
        let mut out: Vec<String> = vec![];
        let span = news_days * DAY;
        let mut recent: Vec<Conduct> = self.acts.iter().filter(|(_, a)| t - a.t <= span).map(|(c, _)| *c).collect();
        recent.sort_by(|a, b| self.acts[b].t.cmp(&self.acts[a].t).then(a.name().cmp(b.name())));
        let phrases = self.p.phrases as usize;
        for c in recent {
            if out.len() >= phrases {
                break;
            }
            let a = self.acts.get_mut(&c).unwrap();
            if !a.told.insert(asker.to_string()) {
                continue;
            }
            let did = a.did;
            let position = if did { 10_000 } else { 0 };
            // (I mention what I did only if it sits within reach of what I take to be approved, or my integrity is high.)
            let tells = (position - self.rows[&c].approves).abs() <= self.p.conceal_bps || env.integrity() * 10_000.0 >= self.p.integrity_tells_bps as f64;
            if tells {
                out.push(culture_words::did(c, did));
            }
            if out.len() < phrases {
                out.push(culture_words::says(c, self.says(env, c, t)));
            }
        }
        self.acts.retain(|_, a| t - a.t <= span);
        let mut heard: Vec<(Conduct, i64)> = self.heard_of.iter().map(|(c, h)| (*c, h.t)).collect();
        heard.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.name().cmp(b.0.name())));
        for (c, ht) in heard {
            if t - ht > span {
                self.heard_of.remove(&c);
                continue;
            }
            if out.len() >= phrases || self.heard_of[&c].told.contains(asker) || self.acts.contains_key(&c) {
                continue;
            }
            self.heard_of.get_mut(&c).unwrap().told.insert(asker.to_string());
            let says = self.says(env, c, t);
            if says.div_euclid(2_000) != 2 {
                out.push(culture_words::says(c, says));
            }
        }
        out.retain(|s| !s.is_empty());
        out
    }

    // ------------------------------------------------------------ ordinary talk about others' conduct

    /// A tie told me of their own act: now I know it first-hand (the oldest person's acts give way beyond `third_kept`).
    pub fn learn_of(&mut self, about: &str, c: Conduct, did: bool, t: i64) {
        if !self.has(c) {
            return;
        }
        let mut row = match self.of_others.iter().position(|(w, _)| w == about) {
            Some(i) => self.of_others.remove(i).1,
            None => BTreeMap::new(),
        };
        row.insert(c, Act { did, t, told: BTreeSet::new() });
        self.of_others.push((about.to_string(), row));
        while self.of_others.len() > self.p.third_kept.max(0) as usize {
            self.of_others.remove(0);
        }
    }
    /// In a talk with `asker`, maybe tell of one act of a third person I know first-hand (within `gossip_days`, not the
    /// asker's own, not told them before), the most recent first. `roll` draws 0..9,999 on the person's own stream and is
    /// called only when there is something to tell.
    pub fn gossip(&mut self, env: &dyn CultureEnv, asker: &str, t: i64, roll: &mut dyn FnMut() -> i64) -> Option<String> {
        let mut best: Option<(usize, Conduct, i64, String)> = None;
        for (i, (about, row)) in self.of_others.iter().enumerate() {
            if about == asker {
                continue;
            }
            for (c, a) in row {
                if a.told.contains(asker) || t - a.t > self.p.gossip_days * DAY {
                    continue;
                }
                let key = format!("{about}{}", c.name());
                let better = match &best {
                    None => true,
                    Some((_, _, bt, bkey)) => a.t > *bt || (a.t == *bt && key < *bkey),
                };
                if better {
                    best = Some((i, *c, a.t, key));
                }
            }
        }
        let (i, c, _, _) = best?;
        if roll() >= self.p.gossip_bps {
            return None;
        }
        let a = self.of_others[i].1.get_mut(&c).unwrap();
        a.told.insert(asker.to_string());
        let did = a.did;
        let about = self.of_others[i].0.clone();
        let said = self.says(env, c, t);
        Some(culture_words::about(&about, c, did, if did { said } else { 10_000 - said }))
    }
    /// Told by a tie of a third person's act and what the teller says of it: one sighting along the route, what the teller
    /// said is what is approved, and my reaction to the one talked about. The same act told twice is counted once.
    pub fn hear_about(&mut self, env: &dyn CultureEnv, who: &str, c: Conduct, did: bool, approval: i64, t: i64, route: Route) -> Option<Reaction> {
        if !self.has(c) {
            return None;
        }
        let key = format!("{who}|{}|{did}", c.name());
        let known = self.of_others.iter().find(|(w, _)| w == who).and_then(|(_, row)| row.get(&c)).is_some_and(|a| a.did == did);
        if self.told_of.contains(&key) || known {
            return None;
        }
        self.told_of.push(key);
        while self.told_of.len() > 64 {
            self.told_of.remove(0);
        }
        self.see_act(c, did, route);
        self.hear_said(c, if did { approval } else { 10_000 - approval }, route);
        self.note_heard(c, t);
        self.react(env, c, did, t)
    }

    // ------------------------------------------------------------ what a tie's act is to me (step 4)

    /// A tie's act, told to me: privately judged by `own` (beyond `margin_bps` of the middle a tie cools by up to
    /// `cool_bps` or warms by up to `esteem_bps`); a verdict voiced only if what I would SAY sits beyond the margin.
    pub fn react(&self, env: &dyn CultureEnv, c: Conduct, did: bool, t: i64) -> Option<Reaction> {
        let r = self.read(env, c, t)?;
        let m = self.p.margin_bps;
        let thought = if did { r.own } else { 10_000 - r.own };
        let said = if did { r.says } else { 10_000 - r.says };
        let dev = thought - 5_000;
        let tie = if dev.abs() <= m {
            0
        } else if dev < 0 {
            -math::round((self.p.cool_bps * -dev) as f64 / 5_000.0)
        } else {
            math::round((self.p.esteem_bps * dev) as f64 / 5_000.0)
        };
        let voice = ((said - 5_000).abs() > m).then_some(said);
        if tie == 0 && voice.is_none() {
            None
        } else {
            Some(Reaction { tie, voice })
        }
    }
    /// Told what someone says of what I did: it moves what I take to be approved; held against, a dent to belonging of up
    /// to `disapproved_bps`, from half to one and a half times as I conform. Returns the dent (0 when approved).
    pub fn judged(&mut self, env: &dyn CultureEnv, c: Conduct, did: bool, approval: i64, route: Route) -> i64 {
        if !self.has(c) {
            return 0;
        }
        self.hear_said(c, if did { approval } else { 10_000 - approval }, route);
        if approval >= 5_000 {
            0
        } else {
            math::round(self.p.disapproved_bps as f64 * (0.5 + env.conformity()) * ((5_000 - approval) as f64 / 5_000.0))
        }
    }
    /// The points the lean adds to a way a want may take.
    pub fn way(&self, env: &dyn CultureEnv, c: Conduct, t: i64) -> i64 {
        math::round(self.p.way_points as f64 * (self.p.sway_milli as f64 / 1_000.0) * self.lean(env, c, t))
    }
    /// How much an event bears on trust in whoever did it (a weight for the one computation it enters, as TS's).
    pub fn bearing(&self, strength: i64, own: i64) -> f64 {
        (strength as f64 / 10_000.0) * (self.p.bystander_bps as f64 / 10_000.0) * ((own - 5_000).abs() as f64 / 5_000.0)
    }
    /// What a tie warms by when it tells me what I did is approved.
    pub fn warmth(&self) -> i64 {
        round_div(self.p.esteem_bps, 2)
    }
    /// A tie told me of an act: I may say what I think of it, to whoever asks, for the next days.
    pub fn note_heard(&mut self, c: Conduct, t: i64) {
        if self.has(c) {
            self.heard_of.insert(c, HeardOf { t, told: BTreeSet::new() });
        }
    }

    // ------------------------------------------------------------ children and newcomers (step 4)

    /// Where I come from, learned now; where the dial gives that group's figures and I took nothing from a household, I
    /// start from them (my own lean restarted at t = 0, as TS did).
    pub fn set_group(&mut self, env: &dyn CultureEnv, dial: &CultureDial, group: Option<&str>, from_household: &BTreeSet<Conduct>) {
        self.origin = group.map(str::to_string);
        let Some(group) = group else { return };
        for c in self.held.clone() {
            let Some(g) = dial.by_origin.get(group).and_then(|m| m.get(c.name())) else { continue };
            if from_household.contains(&c) {
                continue;
            }
            let r = self.rows.get_mut(&c).unwrap();
            if let Some(d) = g.does_bps {
                r.does = d.clamp(0, 10_000);
            }
            if let Some(a) = g.approves_bps {
                r.approves = a.clamp(0, 10_000);
            }
            self.rebase(env, c, 0);
        }
        self.dirty = true;
    }
    /// My own lean restarted from the picture I have now (the same draw, the values as they stand).
    fn rebase(&mut self, env: &dyn CultureEnv, c: Conduct, t: i64) {
        let z = z_of(env, c);
        let (own_sd, values) = (self.p.own_sd_bps as f64, self.p.values_bps as f64);
        let r = self.rows.get_mut(&c).unwrap();
        r.z_start_micro = math::round(z * MICRO);
        r.own_base = math::clamp_bps(r.approves as f64 + own_sd * (r.lean0_micro as f64 / MICRO) + values * (r.z_start_micro as f64 / MICRO));
        r.own_at = t;
    }
    /// Coming of age in a household: my picture is the mean of what the parents told me, held at `prior_weight`. A conduct
    /// no parent spoke of keeps its picture. Returns the conducts taken.
    pub fn adopt_household(&mut self, env: &dyn CultureEnv, told: &[Vec<HouseholdRow>], t: i64) -> BTreeSet<Conduct> {
        let mut taken = BTreeSet::new();
        for c in self.held.clone() {
            let rows: Vec<&HouseholdRow> = told.iter().flat_map(|parent| parent.iter().filter(|x| x.conduct == c)).collect();
            if rows.is_empty() {
                continue;
            }
            let n = rows.len() as f64;
            let prior = self.p.prior_weight * E4;
            let r = self.rows.get_mut(&c).unwrap();
            r.does = math::clamp_bps(rows.iter().map(|x| x.does).sum::<i64>() as f64 / n);
            r.approves = math::clamp_bps(rows.iter().map(|x| x.approves).sum::<i64>() as f64 / n);
            r.n_e4 = prior;
            self.rebase(env, c, t);
            taken.insert(c);
        }
        if !taken.is_empty() {
            self.dirty = true;
        }
        taken
    }
    /// What I tell a child who asks: my picture of each conduct I hold.
    pub fn household(&self) -> Vec<HouseholdRow> {
        self.held.iter().map(|c| HouseholdRow { conduct: *c, does: self.rows[c].does, approves: self.rows[c].approves }).collect()
    }
    /// Arrived here from elsewhere: I hold the picture I bring lightly (Berry: acculturation).
    pub fn arrive(&mut self, _t: i64) {
        let w = self.p.newcomer_weight * E4;
        for r in self.rows.values_mut() {
            r.n_e4 = w;
        }
        self.dirty = true;
    }

    // ------------------------------------------------------------ the record

    /// The record's section, positional: each conduct's row `[does, approves, own, says, n]` in whole percent (n whole),
    /// None where not held, trailing Nones left off. Worked out again only when a picture moved or `REFRESH_DAYS` passed
    /// (or `t` went back); `section_version` says when it was.
    pub fn section(&mut self, env: &dyn CultureEnv, t: i64) -> &NormsSection {
        let fresh = self.cached.is_some() && !self.dirty && t - self.cached_at < REFRESH_DAYS * DAY && t >= self.cached_at;
        if !fresh {
            self.dirty = false;
            self.cached_at = t;
            let mut rows: NormsSection = CONDUCTS
                .iter()
                .map(|&c| {
                    self.read(env, c, t)
                        .map(|r| [round_div(r.does, 100), round_div(r.approves, 100), round_div(r.own, 100), round_div(r.says, 100), round_div(r.n_e4, E4)])
                })
                .collect();
            while rows.last() == Some(&None) {
                rows.pop();
            }
            self.cached = Some(rows);
            self.version += 1;
        }
        self.cached.as_ref().unwrap()
    }
    /// How many times the section has been worked out anew (where TS compared the array's identity).
    pub fn section_version(&self) -> u64 {
        self.version
    }
}

/// The values that speak to a conduct, summed (signed, in standard deviations).
fn z_of(env: &dyn CultureEnv, c: Conduct) -> f64 {
    value_map(c).iter().fold(0.0, |a, &(v, s)| a + s as f64 * env.z(v))
}

/// How long the record's section may go without being worked out again when nothing moved a picture.
pub const REFRESH_DAYS: i64 = 30;

/// A standard normal from a stream: the sum of 12 uniforms less 6 (Irwin-Hall), as TS summed it.
pub fn standard_normal(rng: &mut Rng) -> f64 {
    let mut s = 0.0;
    for _ in 0..12 {
        s += rng.below(1_000_001) as f64 / 1_000_000.0;
    }
    s - 6.0
}

/// TS `CULTURE_VALUES`.
pub const CULTURE_VALUES: [Value; 10] = Value::ALL;

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_core::rng::Randomness;
    use serde_json::json;

    fn dial_of(more: Json) -> CultureDial {
        culture_dial(&json!({ "culture": more })).unwrap().unwrap()
    }
    fn rates(list: &[(Conduct, i64)]) -> BTreeMap<Conduct, i64> {
        list.iter().copied().collect()
    }
    fn all_rates() -> BTreeMap<Conduct, i64> {
        use Conduct::*;
        rates(&[(AnswerTribunal, 6_000), (StayPastNotice, 2_000), (TakeToTribunal, 1_500), (Complain, 3_000), (TakeIn, 5_000), (JoinUnion, 3_500), (Strike, 8_500), (TakeFromEmployer, 300)])
    }
    fn flat(conformity: f64, belonging: f64, integrity: f64) -> Standing {
        Standing { z: [0.0; 10], conformity, belonging, integrity }
    }
    /// A person from a seed (culture.test.ts `someone`): values and conformity drawn, belonging and integrity a half.
    fn someone(i: usize, dial: &CultureDial) -> (Culture, Standing) {
        let mut r = Randomness::new(7).stream(&[&format!("p{i}"), "x"]);
        let mut z = [0.0; 10];
        for v in z.iter_mut() {
            *v = standard_normal(&mut r).clamp(-3.0, 3.0);
        }
        let k = (0.5 + 0.15 * standard_normal(&mut r)).clamp(0.0, 1.0);
        let env = Standing { z, conformity: k, belonging: 0.5, integrity: 0.5 };
        let pid = format!("p{i}");
        let mut draw = |c: Conduct| standard_normal(&mut Randomness::new(7).stream(&[&pid, &format!("culture-own-{}", c.name())]));
        (Culture::new(dial.params.clone(), dial, &env, &mut draw, &all_rates(), None, 0), env)
    }
    /// A person with their own lean fixed (culture-step4.test.ts `mk`).
    fn fixed(d: &CultureDial, draw: f64, env: &Standing, rates: &BTreeMap<Conduct, i64>) -> Culture {
        Culture::new(d.params.clone(), d, env, &mut |_| draw, rates, None, 0)
    }
    fn step4_rates() -> BTreeMap<Conduct, i64> {
        use Conduct::*;
        rates(&[(AnswerTribunal, 6_000), (Complain, 3_000), (Strike, 8_500), (JoinUnion, 3_500), (TakeIn, 5_000)])
    }
    fn complain_dial(does: i64, approves: i64) -> CultureDial {
        dial_of(json!({ "profile": { "conducts": { "complain": { "does_bps": does, "approves_bps": approves } } } }))
    }

    #[test]
    fn the_sizes_are_checked() {
        assert_eq!(culture_params(&Json::Null).unwrap(), CULTURE_DEFAULTS);
        assert!(culture_params(&json!({ "window": 2 })).unwrap_err().contains("window"));
        assert!(culture_params(&json!({ "sway_milli": 1_500 })).unwrap_err().contains("sway_milli"));
        assert!(culture_params(&json!({ "close_weight": 0 })).unwrap_err().contains("at least 1"));
        assert!(culture_params(&json!({ "own_sd_bps": 12_000 })).unwrap_err().contains("share"));
        assert!(culture_params(&json!({ "reputation_scale_milli": -1 })).is_err());
        assert!(culture_params(&json!({ "gossip_bps": 10_001 })).is_err());
        assert!(culture_params(&json!({ "gossip_days": 0 })).is_err());
        assert!(culture_params(&json!({ "third_kept": 0 })).is_err());
        assert!(culture_params(&json!({ "slots": 2.5 })).is_err());
        assert_eq!(culture_params(&json!({ "slots": 5.0 })).unwrap().slots, 5);
        assert!(culture_dial(&json!({ "culture": { "conducts": ["be_good"] } })).unwrap_err().contains("not a conduct"));
        assert_eq!(culture_dial(&json!({})).unwrap(), None);
        assert_eq!(culture_dial(&json!({ "initiative_bps": 10_000 })).unwrap(), None);
        assert_eq!(culture_dial(&json!({ "culture": { "sway_milli": 500 } })).unwrap().unwrap().params.sway_milli, 500);
        // The JSON keys are TS's.
        let v = serde_json::to_value(CULTURE_DEFAULTS).unwrap();
        assert_eq!(v["half_life_told_days"], 180);
        assert_eq!(PARAM_KEYS.len(), 45);
    }

    #[test]
    fn a_person_starts_with_the_profiles_picture() {
        let dial = complain_dial(2_000, 7_000);
        let (c, env) = someone(1, &dial);
        assert!(c.held.contains(&Conduct::Complain));
        let r = c.read(&env, Conduct::Complain, 0).unwrap();
        assert_eq!((r.does, r.approves, r.n_e4), (2_000, 7_000, CULTURE_DEFAULTS.prior_weight * E4));
        let (s, env) = someone(1, &dial_of(json!({})));
        let r = s.read(&env, Conduct::AnswerTribunal, 0).unwrap();
        assert_eq!((r.does, r.approves), (6_000, CULTURE_DEFAULTS.approves_default_bps));
        assert!(!s.has(Conduct::ApplyPossession));
        let (o, _) = someone(1, &dial_of(json!({ "profile": { "conducts": { "apply_possession": { "does_bps": 6_000 } } } })));
        assert!(o.has(Conduct::ApplyPossession));
    }

    #[test]
    fn the_lean_sums_to_nothing_over_a_drawn_town() {
        let dial = dial_of(json!({}));
        let town: Vec<(Culture, Standing)> = (0..3_000).map(|i| someone(i, &dial)).collect();
        for c in PERSONS_CONDUCTS {
            let (mut sum, mut sq) = (0.0, 0.0);
            for (p, env) in &town {
                let l = p.lean(env, c, 0);
                sum += l;
                sq += l * l;
            }
            let n = town.len() as f64;
            assert!((sum / n).abs() < 0.05, "{c:?}");
            assert!((sq / n).sqrt() > 0.1 && (sq / n).sqrt() < 1.5, "{c:?}");
        }
    }

    #[test]
    fn a_rate_is_swayed_by_the_lean_and_held() {
        let (c, env) = someone(3, &dial_of(json!({})));
        for k in PERSONS_CONDUCTS {
            let lean = c.lean(&env, k, 0);
            assert!(lean.abs() <= 3.0);
            let (up, down) = (c.term(&env, 4_000, k, 0, 1), c.term(&env, 4_000, k, 0, -1));
            assert!((0..=10_000).contains(&up));
            if lean > 0.0 {
                assert!(up >= 4_000 && down <= 4_000);
            }
            if lean < 0.0 {
                assert!(up <= 4_000 && down >= 4_000);
            }
        }
    }

    #[test]
    fn the_section_is_bounded_and_whole_percent() {
        let mut figs = serde_json::Map::new();
        for c in CONDUCTS {
            figs.insert(c.name().into(), json!({ "does_bps": 4_000, "approves_bps": 6_000 }));
        }
        let dial = dial_of(json!({ "profile": { "conducts": figs } }));
        let (mut c, env) = someone(5, &dial);
        assert_eq!(c.held.len(), CONDUCTS.len());
        let before = serde_json::to_string(c.section(&env, 0)).unwrap().len();
        for i in 0..1_000 {
            for k in CONDUCTS {
                c.see_act(k, i % 3 == 0, Route::Tie);
                c.hear_said(k, 9_999, Route::Published);
            }
        }
        let after = serde_json::to_string(c.section(&env, 3_650 * DAY)).unwrap().len();
        assert!(after < 750 && after.abs_diff(before) < 150);
        for (_, row) in norms_rows(c.section(&env, 0)) {
            assert!(row[..4].iter().all(|x| (0..=100).contains(x)));
        }
    }

    #[test]
    fn what_is_thought_settles_by_half_in_internalise_days() {
        let (c, env) = someone(9, &dial_of(json!({})));
        let a0 = c.read(&env, Conduct::Complain, 0).unwrap();
        let a1 = c.read(&env, Conduct::Complain, CULTURE_DEFAULTS.internalise_days * DAY).unwrap();
        let (g0, g1) = ((a0.own - a0.approves) as f64, (a1.own - a1.approves) as f64);
        assert!((g1 - g0 / 2.0).abs() <= 2.0);
    }

    #[test]
    fn the_section_is_positional_small_and_kept_until_a_picture_moves() {
        let (mut c, env) = someone(3, &dial_of(json!({})));
        let sec = c.section(&env, 0).clone();
        let v = c.section_version();
        assert!(sec.len() <= 12 && serde_json::to_string(&sec).unwrap().len() < 200);
        assert_eq!(norms_rows(&sec).iter().map(|r| r.0).collect::<Vec<_>>(), c.held);
        c.section(&env, 5 * DAY);
        assert_eq!(c.section_version(), v); // not worked out again
        c.section(&env, 31 * DAY);
        assert_eq!(c.section_version(), v + 1); // REFRESH_DAYS passed
        c.see_act(Conduct::Complain, true, Route::Tie);
        c.section(&env, 32 * DAY);
        assert_eq!(c.section_version(), v + 2); // a picture moved
    }

    #[test]
    fn pressure_is_reputation_over_reputation_plus_integrity() {
        let d = dial_of(json!({ "conducts": ["complain"], "profile": { "conducts": { "complain": { "does_bps": 3_000, "approves_bps": 8_000 } } } }));
        let c = fixed(&d, -4.0, &flat(0.5, 0.5, 0.5), &rates(&[(Conduct::Complain, 3_000)]));
        assert_eq!(c.pressure(&flat(0.5, 0.0, 0.5)), 0.0);
        assert_eq!(c.pressure(&flat(0.0, 0.5, 0.5)), 0.0);
        assert_eq!(c.pressure(&flat(0.5, 0.5, 0.0)), 1.0);
        assert_eq!(c.pressure(&flat(0.5, 0.0, 0.0)), 0.0);
        assert_eq!(c.pressure(&flat(1.0, 1.0, 1.0)), 0.5);
        assert!((c.pressure(&flat(0.5, 0.5, 0.5)) - 0.25 / 0.75).abs() < 1e-10);
        assert!(c.pressure(&flat(0.5, 0.8, 0.5)) > c.pressure(&flat(0.5, 0.4, 0.5)));
        assert!(c.pressure(&flat(0.5, 0.5, 0.8)) < c.pressure(&flat(0.5, 0.5, 0.4)));
        let env = flat(0.5, 0.5, 0.5);
        let mk = |draw: f64| fixed(&d, draw, &env, &rates(&[(Conduct::Complain, 3_000)]));
        for draw in [-4.0, -2.0, 0.0] {
            let r = mk(draw).read(&env, Conduct::Complain, 0).unwrap();
            assert!(r.says >= r.own.min(r.approves) && r.says <= r.own.max(r.approves));
        }
        let (far, near) = (mk(-4.0).read(&env, Conduct::Complain, 0).unwrap(), mk(-1.0).read(&env, Conduct::Complain, 0).unwrap());
        assert!(far.says - far.own > near.says - near.own);
        assert!(far.says < far.approves - 2_000);
        let same = fixed(&d, 0.0, &flat(0.5, 0.5, 0.0), &rates(&[(Conduct::Complain, 3_000)]));
        let r = same.read(&flat(0.5, 0.5, 0.0), Conduct::Complain, 0).unwrap();
        assert!((r.says - r.own).abs() < 1_000);
        let d2 = dial_of(json!({ "step": { "reputation_scale_milli": 2_000 }, "profile": { "conducts": { "complain": { "does_bps": 3_000 } } } }));
        assert!(fixed(&d2, 0.0, &env, &BTreeMap::new()).pressure(&env) > c.pressure(&env));
    }

    #[test]
    fn a_route_outside_the_three_is_refused() {
        for bad in ["register", "directory", "town", "census", "everyone", ""] {
            assert!(Route::parse(bad).unwrap_err().contains("along a tie, by being there, or by what is published"));
        }
        assert_eq!(ROUTES.map(|r| Route::parse(r.name()).unwrap()), ROUTES);
        let (c, _) = someone(1, &dial_of(json!({})));
        assert_eq!([Route::Tie, Route::Here, Route::CloseTie, Route::Published].map(|r| c.weight(r)), [1, 1, 2, 4]);
    }

    #[test]
    fn a_ring_of_twenty_moves_as_the_arithmetic_says() {
        let d = dial_of(json!({}));
        let env = flat(0.5, 0.5, 0.5);
        let r4 = rates(&[(Conduct::AnswerTribunal, 6_000), (Conduct::Complain, 3_000), (Conduct::Strike, 8_500), (Conduct::JoinUnion, 3_500)]);
        let mk = |i: usize| {
            let q = format!("q{i}");
            Culture::new(d.params.clone(), &d, &env, &mut |c| standard_normal(&mut Randomness::new(3).stream(&[&q, c.name()])), &r4, None, 0)
        };
        let n = 20;
        let did = |i: usize| i % 3 == 0;
        let mut ring: Vec<Culture> = (0..n).map(mk).collect();
        let mut reference = vec![(3_000i64, CULTURE_DEFAULTS.prior_weight); n];
        for _ in 0..15 {
            for i in 0..n {
                for j in [(i + 1) % n, (i + n - 1) % n] {
                    ring[i].see_act(Conduct::Complain, did(j), Route::Tie);
                    let r = &mut reference[i];
                    let nn = CULTURE_DEFAULTS.window.min(r.1 + 1);
                    r.0 = math::clamp_bps(r.0 as f64 + ((if did(j) { 10_000 } else { 0 }) - r.0) as f64 / nn as f64);
                    r.1 = nn;
                }
            }
        }
        for i in 0..n {
            let got = ring[i].read(&env, Conduct::Complain, 0).unwrap();
            assert_eq!((got.does, got.n_e4), (reference[i].0, reference[i].1 * E4));
        }
        let distinct: BTreeSet<i64> = ring.iter().map(|c| c.read(&env, Conduct::Complain, 0).unwrap().does).collect();
        assert!(distinct.len() > 1);
        // A published count, then what is said.
        let mut c = mk(2);
        let n0 = c.read(&env, Conduct::Strike, 0).unwrap().n_e4 / E4;
        c.see_share(Conduct::Strike, 2_000, Route::Published);
        let r = c.read(&env, Conduct::Strike, 0).unwrap();
        assert_eq!(r.n_e4, CULTURE_DEFAULTS.window.min(n0 + 4) * E4);
        assert_eq!(r.does, math::round(8_500.0 + ((2_000 - 8_500) * 4) as f64 / (n0 + 4) as f64));
        c.hear_said(Conduct::Strike, 1_000, Route::Tie);
        assert_eq!(c.read(&env, Conduct::Strike, 0).unwrap().approves, math::round(5_000.0 + (1_000 - 5_000) as f64 / (n0 + 4 + 1) as f64));
    }

    #[test]
    fn telling_each_act_once_to_each_the_recent_only_and_what_sits_ill_kept_back() {
        let d = dial_of(json!({ "profile": { "conducts": { "complain": { "approves_bps": 1_000 }, "strike": { "approves_bps": 9_000 } } } }));
        let env = flat(0.5, 0.5, 0.1);
        let r = rates(&[(Conduct::Complain, 3_000), (Conduct::Strike, 8_500)]);
        let mut c = fixed(&d, 0.3, &env, &r);
        c.act(Conduct::Complain, true, 10 * DAY);
        c.act(Conduct::Strike, true, 11 * DAY);
        let first = c.tell(&env, "a", 12 * DAY, 90).join(" ");
        assert!(first.contains(&culture_words::did(Conduct::Strike, true)));
        assert!(!first.contains(&culture_words::did(Conduct::Complain, true)));
        assert!(first.contains("I say"));
        assert!(!c.tell(&env, "a", 13 * DAY, 90).join(" ").contains(&culture_words::did(Conduct::Strike, true)));
        assert!(c.tell(&env, "b", 13 * DAY, 90).join(" ").contains(&culture_words::did(Conduct::Strike, true)));
        assert!(c.tell(&env, "c", 200 * DAY, 90).is_empty());
        let bold_env = flat(0.5, 0.5, 0.95);
        let mut bold = fixed(&d, 0.3, &bold_env, &r);
        bold.act(Conduct::Complain, true, 10 * DAY);
        assert!(bold.tell(&bold_env, "a", 11 * DAY, 90).join(" ").contains(&culture_words::did(Conduct::Complain, true)));
    }

    #[test]
    fn the_words_are_tss_and_round_trip() {
        assert_eq!(culture_words::did(Conduct::Complain, true), "When a service failed: I wrote to the town.");
        assert_eq!(culture_words::says(Conduct::Complain, 3_100), "I say writing to the town about a service is wrong.");
        assert_eq!(culture_words::did(Conduct::ApplyPossession, true), "");
        assert_eq!(
            culture_words::heard(&culture_words::did(Conduct::Strike, false)),
            Some(Heard { did: vec![DidHeard { conduct: Conduct::Strike, did: false }], says: vec![] })
        );
        assert_eq!(culture_words::heard(&culture_words::says(Conduct::Complain, 3_100)).unwrap().says, vec![SaysHeard { conduct: Conduct::Complain, bps: 3_000 }]);
        assert_eq!(culture_words::from_heard(&culture_words::from("north")).as_deref(), Some("north"));
        assert_eq!(culture_words::from_heard("I come from the a.b group. I come from the south group."), Some("south".into()));
        assert_eq!(culture_words::from_heard("I come from the  group."), None);
        let text = culture_words::about("p12", Conduct::Complain, true, 1_000);
        assert_eq!(text, "About p12: When a service failed: they wrote to the town. Of that, I say it is plainly wrong.");
        assert_eq!(
            culture_words::about_heard(&format!("I am well. {text} Anything else?")),
            Some(AboutHeard { who: "p12".into(), conduct: Conduct::Complain, did: true, approval: 1_000 })
        );
        assert_eq!(
            culture_words::about_heard(&culture_words::about("p3", Conduct::JoinUnion, false, 9_000)),
            Some(AboutHeard { who: "p3".into(), conduct: Conduct::JoinUnion, did: false, approval: 9_000 })
        );
        assert_eq!(culture_words::heard(&text), None);
        assert_eq!(culture_words::verdict_heard(&text), None);
        for c in [Conduct::AnswerTribunal, Conduct::Complain, Conduct::TakeIn, Conduct::Strike, Conduct::TakeFromEmployer] {
            for did in [true, false] {
                for bps in [1_000, 3_000, 7_000, 9_000] {
                    let t = culture_words::verdict(c, did, bps);
                    assert_eq!(culture_words::verdict_heard(&t), Some(VerdictHeard { conduct: c, did, approval: bps }));
                    assert_eq!(culture_words::heard(&t), None);
                }
            }
        }
        assert_eq!(culture_words::verdict(Conduct::Complain, false, 9_000), "Of your not writing to the town about a service: I say it is plainly right.");
        assert_eq!(culture_words::verdict_heard("Of course I say it is right."), None);
        let h = format!("{} {}", culture_words::household(Conduct::Complain, 3_000, 6_000), culture_words::household(Conduct::TakeIn, 5_000, 4_000));
        assert_eq!(h.split(". ").next().unwrap(), "As I see it, of writing to the town about a service: 3 in 10 do it, 6 in 10 would call it right");
        assert_eq!(
            culture_words::household_heard(&h),
            vec![HouseholdRow { conduct: Conduct::Complain, does: 3_000, approves: 6_000 }, HouseholdRow { conduct: Conduct::TakeIn, does: 5_000, approves: 4_000 }]
        );
        assert_eq!(culture_words::household(Conduct::Complain, 2_500, 3_499), "As I see it, of writing to the town about a service: 3 in 10 do it, 3 in 10 would call it right.");
    }

    #[test]
    fn voicing_approval_of_what_one_privately_doubts() {
        let d = complain_dial(3_000, 8_000);
        let env = flat(1.0, 1.0, 0.05);
        let c = fixed(&d, -4.0, &env, &step4_rates());
        let r = c.read(&env, Conduct::Complain, 0).unwrap();
        assert!(r.own < 2_500 && r.says > 7_500);
        let re = c.react(&env, Conduct::Complain, true, 0).unwrap();
        assert!(re.tie < 0 && re.voice.unwrap() > 7_500);
        assert!(culture_words::verdict(Conduct::Complain, true, re.voice.unwrap()).ends_with("right."));
        let frank_env = flat(0.2, 0.2, 1.0);
        let frank = fixed(&d, -4.0, &frank_env, &step4_rates());
        assert!(frank.react(&frank_env, Conduct::Complain, true, 0).unwrap().voice.unwrap() < 2_500);
    }

    #[test]
    fn a_tie_cools_beyond_the_margin_and_warms_toward_what_is_held_with() {
        let d = complain_dial(3_000, 5_000);
        let env = flat(0.5, 0.5, 0.5);
        let mk = |draw: f64| fixed(&d, draw, &env, &step4_rates());
        assert_eq!(mk(0.0).react(&env, Conduct::Complain, true, 0), None);
        let against = mk(-3.0).react(&env, Conduct::Complain, true, 0).unwrap();
        let worse = mk(-3.3).react(&env, Conduct::Complain, true, 0).unwrap();
        assert!(against.tie < 0 && against.tie.abs() <= CULTURE_DEFAULTS.cool_bps && worse.tie <= against.tie);
        let warm = mk(3.0).react(&env, Conduct::Complain, true, 0).unwrap();
        assert!(warm.tie > 0 && warm.tie <= CULTURE_DEFAULTS.esteem_bps);
        assert!(mk(3.0).react(&env, Conduct::Complain, false, 0).unwrap().tie < 0);
    }

    #[test]
    fn being_told_it_is_held_against_you_dents_belonging() {
        let d = complain_dial(3_000, 5_000);
        let (ce, le) = (flat(1.0, 0.5, 0.5), flat(0.0, 0.5, 0.5));
        let (mut conformist, mut loner) = (fixed(&d, 0.0, &ce, &step4_rates()), fixed(&d, 0.0, &le, &step4_rates()));
        let a0 = conformist.read(&ce, Conduct::Complain, 0).unwrap().approves;
        let dent = conformist.judged(&ce, Conduct::Complain, true, 1_000, Route::Tie);
        let small = loner.judged(&le, Conduct::Complain, true, 1_000, Route::Tie);
        assert!(dent > small && small > 0 && dent <= math::round(CULTURE_DEFAULTS.disapproved_bps as f64 * 1.5));
        assert!(conformist.read(&ce, Conduct::Complain, 0).unwrap().approves < a0);
        let b0 = conformist.read(&ce, Conduct::Complain, 0).unwrap().approves;
        assert_eq!(conformist.judged(&ce, Conduct::Complain, true, 9_000, Route::CloseTie), 0);
        assert!(conformist.read(&ce, Conduct::Complain, 0).unwrap().approves > b0);
        let env = flat(0.5, 0.5, 0.5);
        let mut e = fixed(&d, 0.0, &env, &step4_rates());
        let e0 = e.read(&env, Conduct::Complain, 0).unwrap().approves;
        e.judged(&env, Conduct::Complain, false, 1_000, Route::Tie);
        assert!(e.read(&env, Conduct::Complain, 0).unwrap().approves > e0);
        assert_eq!(e.warmth(), 100);
    }

    fn street() -> (Vec<Culture>, Standing) {
        let d = complain_dial(3_000, 2_000);
        let env = flat(1.0, 1.0, 0.0);
        ((0..12).map(|_| fixed(&d, 3.0, &env, &step4_rates())).collect(), env)
    }
    fn gap(s: &[Culture], env: &Standing, t: i64) -> f64 {
        let n = s.len() as f64;
        s.iter().map(|c| c.read(env, Conduct::Complain, t).unwrap().own as f64).sum::<f64>() / n
            - s.iter().map(|c| c.read(env, Conduct::Complain, t).unwrap().approves as f64).sum::<f64>() / n
    }

    #[test]
    fn pluralistic_ignorance_and_a_published_count_that_breaks_it() {
        let (mut s, env) = street();
        for c in &s {
            let r = c.read(&env, Conduct::Complain, 0).unwrap();
            assert!(r.own >= 6_500 && r.says < 3_500);
        }
        let g0 = gap(&s, &env, 0);
        assert!(g0 > 4_000.0);
        for _ in 0..30 {
            for i in 0..s.len() {
                let said = s[i].read(&env, Conduct::Complain, 0).unwrap().says;
                let j = (i + 1) % s.len();
                s[j].hear_said(Conduct::Complain, said, Route::Tie);
            }
        }
        assert!(gap(&s, &env, 0) > g0 - 600.0);
        let (quiet, _) = street();
        let (mut told, _) = street();
        let g0 = gap(&told, &env, 0);
        for _ in 0..3 {
            for c in told.iter_mut() {
                c.hear_said(Conduct::Complain, 7_000, Route::Published);
            }
        }
        assert!(gap(&told, &env, 0) < g0 / 3.0);
        assert!(told.iter().all(|c| c.read(&env, Conduct::Complain, 0).unwrap().says > 5_000));
        assert!(gap(&quiet, &env, 100 * DAY) > g0 - 400.0);
        assert!(gap(&quiet, &env, 100 * DAY) > gap(&told, &env, 100 * DAY) + 2_000.0);
        assert!(told[0].react(&env, Conduct::Complain, true, 0).and_then(|r| r.voice).unwrap_or(5_000) >= 5_000);
        assert!(quiet[0].react(&env, Conduct::Complain, true, 0).unwrap().voice.unwrap() < 2_500);
    }

    #[test]
    fn what_i_think_of_what_i_was_told_of_i_say_once_to_each() {
        let d = complain_dial(3_000, 5_000);
        let env = flat(0.5, 0.5, 0.9);
        let mut c = fixed(&d, 3.0, &env, &step4_rates());
        assert!(c.tell(&env, "a", 0, 90).is_empty());
        c.note_heard(Conduct::Complain, 10 * DAY);
        let first = c.tell(&env, "a", 11 * DAY, 90);
        assert_eq!(first.len(), 1);
        assert!(first[0] == "I say writing to the town about a service is right." || first[0] == "I say writing to the town about a service is plainly right.");
        assert!(c.tell(&env, "a", 12 * DAY, 90).is_empty());
        assert_eq!(c.tell(&env, "b", 12 * DAY, 90).len(), 1);
        assert!(c.tell(&env, "c", 300 * DAY, 90).is_empty());
        let fe = flat(0.5, 0.5, 0.5);
        let mut flat_one = fixed(&d, 0.0, &fe, &step4_rates());
        flat_one.note_heard(Conduct::Complain, 10 * DAY);
        assert!(flat_one.tell(&fe, "a", 11 * DAY, 90).is_empty());
    }

    #[test]
    fn a_child_takes_the_mean_of_its_parents_and_its_group() {
        let d = dial_of(json!({ "profile": { "conducts": { "complain": { "does_bps": 3_000, "approves_bps": 5_000 }, "strike": { "does_bps": 8_500, "approves_bps": 5_000 } }, "by_origin": { "east": { "strike": { "does_bps": 2_000 } } } } }));
        let env = flat(0.5, 0.5, 0.5);
        let mut child = fixed(&d, 1.0, &env, &step4_rates());
        child.arrive(0);
        assert_eq!(child.read(&env, Conduct::Complain, 0).unwrap().n_e4, CULTURE_DEFAULTS.newcomer_weight * E4);
        let own0 = child.read(&env, Conduct::Complain, 0).unwrap().own;
        let row = |does, approves| HouseholdRow { conduct: Conduct::Complain, does, approves };
        let taken = child.adopt_household(&env, &[vec![row(2_000, 3_000)], vec![row(4_000, 5_000)]], 100 * DAY);
        assert_eq!(taken.into_iter().collect::<Vec<_>>(), vec![Conduct::Complain]);
        let r = child.read(&env, Conduct::Complain, 100 * DAY).unwrap();
        assert_eq!((r.does, r.approves, r.n_e4), (3_000, 4_000, CULTURE_DEFAULTS.prior_weight * E4));
        assert_ne!(r.own, own0);
        child.set_group(&env, &d, Some("east"), &[Conduct::Complain].into_iter().collect());
        assert_eq!(child.group(), Some("east"));
        assert_eq!(child.read(&env, Conduct::Strike, 100 * DAY).unwrap().does, 2_000);
        assert_eq!(child.read(&env, Conduct::Complain, 100 * DAY).unwrap().does, 3_000);
    }

    fn talk() -> (CultureDial, Standing) {
        let d = dial_of(json!({ "step": { "gossip_bps": 10_000 }, "profile": { "conducts": { "complain": { "does_bps": 3_000, "approves_bps": 5_000 }, "join_union": { "does_bps": 3_000, "approves_bps": 5_000 } } } }));
        (d, flat(0.5, 0.5, 0.5))
    }
    fn talker(d: &CultureDial, draw: f64, env: &Standing) -> Culture {
        fixed(d, draw, env, &rates(&[(Conduct::Complain, 3_000), (Conduct::JoinUnion, 3_500)]))
    }

    #[test]
    fn gossip_only_of_what_a_tie_told_me_once_to_each_not_past_gossip_days() {
        let (d, env) = talk();
        let mut c = talker(&d, 0.0, &env);
        let mut always = || 0;
        assert_eq!(c.gossip(&env, "a", 0, &mut always), None);
        c.learn_of("p1", Conduct::Complain, true, 0);
        assert_eq!(c.gossip(&env, "p1", DAY, &mut always), None);
        let told = c.gossip(&env, "a", DAY, &mut always).unwrap();
        let h = culture_words::about_heard(&told).unwrap();
        assert_eq!((h.who.as_str(), h.conduct, h.did), ("p1", Conduct::Complain, true));
        assert_eq!(c.gossip(&env, "a", 2 * DAY, &mut always), None);
        assert!(c.gossip(&env, "b", 2 * DAY, &mut always).is_some());
        assert_eq!(c.gossip(&env, "z", (CULTURE_DEFAULTS.gossip_days + 1) * DAY, &mut always), None);
        c.learn_of("p2", Conduct::Strike, true, 0);
        assert!(c.gossip(&env, "q", DAY, &mut always).is_some());
        // The chance is a draw, made only when there is something to tell.
        let d3 = dial_of(json!({ "step": { "gossip_bps": 3_000 }, "profile": { "conducts": { "complain": { "does_bps": 3_000 } } } }));
        let mut c = talker(&d3, 0.0, &env);
        let mut draws = 0;
        assert_eq!(c.gossip(&env, "a", 0, &mut || { draws += 1; 0 }), None);
        c.learn_of("p1", Conduct::Complain, true, 0);
        assert_eq!(c.gossip(&env, "a", DAY, &mut || { draws += 1; 3_000 }), None);
        assert!(c.gossip(&env, "a", DAY, &mut || { draws += 1; 2_999 }).is_some());
        assert_eq!(draws, 2);
        // Bounded: the oldest person's acts give way.
        let d4 = dial_of(json!({ "step": { "gossip_bps": 10_000, "third_kept": 3 }, "profile": { "conducts": { "complain": { "does_bps": 3_000 } } } }));
        let mut c = talker(&d4, 0.0, &env);
        for i in 0..6 {
            c.learn_of(&format!("p{i}"), Conduct::Complain, true, i * DAY);
        }
        let mut heard = BTreeSet::new();
        for _ in 0..6 {
            if let Some(t) = c.gossip(&env, "ask", 7 * DAY, &mut || 0) {
                heard.insert(culture_words::about_heard(&t).unwrap().who);
            }
        }
        assert_eq!(heard.into_iter().collect::<Vec<_>>(), ["p3", "p4", "p5"]);
    }

    #[test]
    fn gossips_tie_break_is_the_concatenated_name() {
        let (d, env) = talk();
        let mut c = talker(&d, 0.0, &env);
        c.learn_of("p1", Conduct::Complain, true, DAY);
        c.learn_of("p12", Conduct::JoinUnion, true, DAY);
        // "p12join_union" < "p1complain" in byte order ('2' < 'c').
        assert_eq!(culture_words::about_heard(&c.gossip(&env, "a", DAY, &mut || 0).unwrap()).unwrap().who, "p12");
    }

    #[test]
    fn the_hearers_picture_moves_once_for_one_act() {
        let (d, env) = talk();
        let mut me = talker(&d, -2.0, &env);
        let before = me.read(&env, Conduct::Complain, 0).unwrap();
        let r = me.hear_about(&env, "p1", Conduct::Complain, true, 1_000, DAY, Route::Tie).unwrap();
        let after = me.read(&env, Conduct::Complain, DAY).unwrap();
        assert!(after.does > before.does && after.approves < before.approves && r.tie < 0);
        assert_eq!(me.hear_about(&env, "p1", Conduct::Complain, true, 1_000, 2 * DAY, Route::Tie), None);
        assert_eq!(me.read(&env, Conduct::Complain, 2 * DAY).unwrap().does, after.does);
        let mut fan = talker(&d, 2.0, &env);
        assert!(fan.hear_about(&env, "p1", Conduct::Complain, true, 9_000, DAY, Route::Tie).unwrap().tie > 0);
        let mut direct = talker(&d, 0.0, &env);
        direct.learn_of("p9", Conduct::Complain, true, 0);
        assert_eq!(direct.hear_about(&env, "p9", Conduct::Complain, true, 9_000, DAY, Route::Tie), None);
    }

    fn events_person(i: usize) -> (Culture, Standing) {
        let d = dial_of(json!({}));
        let env = flat(0.5, 0.5, 0.5);
        let q = format!("q{i}");
        let r = rates(&[(Conduct::Strike, 8_500), (Conduct::JoinUnion, 3_500), (Conduct::ApplyPossession, 5_000), (Conduct::StayPastNotice, 2_000)]);
        (Culture::new(d.params.clone(), &d, &env, &mut |c| standard_normal(&mut Randomness::new(3).stream(&[&q, c.name()])), &r, None, 0), env)
    }

    #[test]
    fn an_event_is_one_sighting_at_the_routes_weight_times_its_strength() {
        let mk = || events_person(1).0;
        let env = flat(0.5, 0.5, 0.5);
        let (mut seen, mut one, mut two, mut three, mut close, mut reference) = (mk(), mk(), mk(), mk(), mk(), mk());
        let start = reference.read(&env, Conduct::Strike, 0).unwrap().does;
        seen.saw_event(Conduct::Strike, Route::Here, 10_000, None);
        reference.see_act(Conduct::Strike, true, Route::Here);
        assert_eq!(seen.read(&env, Conduct::Strike, 0).unwrap().does, reference.read(&env, Conduct::Strike, 0).unwrap().does);
        one.saw_event(Conduct::Strike, Route::Tie, 6_000, None);
        two.saw_event(Conduct::Strike, Route::Tie, 3_600, None);
        three.saw_event(Conduct::Strike, Route::Tie, 2_160, None);
        let gain = |c: &Culture| c.read(&env, Conduct::Strike, 0).unwrap().does - start;
        assert!(gain(&seen) > gain(&one) && gain(&one) > gain(&two) && gain(&two) > gain(&three) && gain(&three) > 0);
        let w = 0.6;
        assert_eq!(one.read(&env, Conduct::Strike, 0).unwrap().does, math::round(start as f64 + ((10_000 - start) as f64 * w) / (4.0 + w)));
        close.saw_event(Conduct::Strike, Route::CloseTie, 6_000, None);
        assert!(gain(&close) > gain(&one));
        // The teller's said view: one hearing at the same weight, after the sighting.
        let (mut a, mut b, mut c) = (mk(), mk(), mk());
        let s = a.read(&env, Conduct::Strike, 0).unwrap().approves;
        a.saw_event(Conduct::Strike, Route::Tie, 6_000, Some(1_000));
        b.saw_event(Conduct::Strike, Route::Tie, 6_000, None);
        assert_eq!(b.read(&env, Conduct::Strike, 0).unwrap().approves, s);
        assert_eq!(a.read(&env, Conduct::Strike, 0).unwrap().approves, math::round(s as f64 + ((1_000 - s) as f64 * w) / (4.0 + w + w)));
        assert_eq!(a.read(&env, Conduct::Strike, 0).unwrap().n_e4, 46_000);
        c.saw_event(Conduct::TakeIn, Route::Tie, 10_000, Some(1_000));
        assert!(!c.has(Conduct::TakeIn));
    }

    #[test]
    fn the_same_person_has_the_same_lean_and_a_saved_culture_behaves_the_same() {
        let (a, env) = events_person(1);
        let (b, _) = events_person(1);
        for c in &a.held {
            assert_eq!(a.read(&env, *c, 0), b.read(&env, *c, 0));
        }
        // Save, restore, and step both the same way.
        let (d, tenv) = talk();
        let mut x = talker(&d, -1.3, &tenv);
        x.act(Conduct::Complain, true, DAY);
        x.learn_of("p4", Conduct::JoinUnion, false, DAY);
        x.saw_event(Conduct::Complain, Route::Tie, 3_333, Some(9_000));
        x.section(&tenv, DAY);
        let mut y: Culture = serde_json::from_str(&serde_json::to_string(&x).unwrap()).unwrap();
        assert_eq!(x, y);
        for k in [&mut x, &mut y] {
            k.hear_about(&tenv, "p7", Conduct::Complain, false, 2_000, 2 * DAY, Route::CloseTie);
        }
        assert_eq!(x.tell(&tenv, "a", 3 * DAY, 90), y.tell(&tenv, "a", 3 * DAY, 90));
        assert_eq!(x.gossip(&tenv, "b", 3 * DAY, &mut || 0), y.gossip(&tenv, "b", 3 * DAY, &mut || 0));
        assert_eq!(x.section(&tenv, 3 * DAY), y.section(&tenv, 3 * DAY));
        assert_eq!(x.section_version(), y.section_version());
        assert_eq!(x, y);
    }

    /// The TS module on the same streams and the same steps gives these sections, terms and ways (run once with bun,
    /// 2026-10-17): the port's arithmetic is TS's to the basis point.
    #[test]
    fn the_same_people_as_ts_on_the_same_streams() {
        let dial = complain_dial(2_000, 7_000);
        let ts = [
            r#"[[[60,50,22,31,4],[20,50,44,46,4],[15,50,70,64,4],[20,77,85,82,4],[40,50,54,53,5],[35,50,61,58,4],[86,47,40,42,4],[3,50,54,53,4]],[[4446,167],[3737,-99],[3975,-9],[4284,107]]]"#,
            r#"[[[60,50,34,38,4],[20,50,49,49,4],[15,50,35,39,4],[20,77,57,61,4],[40,50,52,51,5],[35,50,51,51,4],[86,47,69,64,4],[3,50,40,42,4]],[[3599,-150],[4631,237],[3970,-11],[4041,15]]]"#,
            r#"[[[60,50,51,50,4],[20,50,69,63,4],[15,50,67,62,4],[20,77,70,72,4],[40,50,47,48,5],[35,50,66,61,4],[86,47,54,52,4],[3,50,51,51,4]],[[4061,23],[4110,41],[3793,-78],[4425,159]]]"#,
            r#"[[[60,50,58,54,4],[20,50,45,47,4],[15,50,60,55,4],[20,77,67,72,4],[40,50,28,38,5],[35,50,50,50,4],[86,47,58,53,4],[3,50,64,58,4]],[[4083,31],[4051,19],[3575,-159],[4000,0]]]"#,
        ];
        for (i, want) in ts.iter().enumerate() {
            let (mut c, env) = someone(i, &dial);
            c.saw_event(Conduct::Strike, Route::Tie, 3_333, Some(1_000));
            c.hear_said(Conduct::Complain, 9_000, Route::CloseTie);
            c.see_act(Conduct::TakeIn, false, Route::Here);
            let t = 400 * DAY;
            let terms: Vec<[i64; 2]> = [Conduct::Complain, Conduct::Strike, Conduct::TakeIn, Conduct::JoinUnion].iter().map(|&k| [c.term(&env, 4_000, k, t, 1), c.way(&env, k, t)]).collect();
            let got = serde_json::to_string(&(c.section(&env, t).clone(), terms)).unwrap();
            assert_eq!(&got, want, "person {i}");
        }
    }

    #[test]
    fn the_standard_normal_is_the_irwin_hall_sum() {
        let mut r = Randomness::new(3).stream(&["q1", "complain"]);
        let mut r2 = Randomness::new(3).stream(&["q1", "complain"]);
        let x = standard_normal(&mut r);
        let sum: u64 = (0..12).map(|_| r2.below(1_000_001)).sum();
        assert!((x - (sum as f64 / 1e6 - 6.0)).abs() < 1e-9);
        assert!((-6.0..=6.0).contains(&x));
    }
}
