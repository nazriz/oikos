//! participants/src/behaviour/reading.ts, in Rust (lane A2): what the words of a paper mean to a person
//! (docs/design/ai-citizens.md section 13; docs/behaviour/reading.md).
//!
//! A reader (a model) says what a worded paper is like, on nine small whole numbers, shown the paper and never a
//! person. This file is the code's half, arithmetic only: it turns two readings (the paper's and the plain paper's)
//! into a SHIFT, and a shift into the multipliers and small sums the code mind applies to a person's own record.
//!
//! The rule that holds all of it (Naz, 2026-10-13): **words scale what a decision does; they never reverse it, and
//! never outweigh it.** `reading_params` refuses any setting that would break it. Every size is a PLACEHOLDER and a
//! dial; directions follow the procedural-justice literature (docs/research/references.md, "Reading").
//!
//! How a reading reaches the citizen (the seam). In TS the citizen calls `ctx.read(paper, "addressee")`, which asks
//! the reading desk (orchestrator/src/reading.ts) for the `PaperRead` it filed when the paper was written
//! (`lookup`), or nothing if it was not read. In Rust the desk is a model service the citizen asks with a
//! `crate::Question`, answered one wake later:
//! - `reading_question(paper_id, standing)`: kind `"reading"`, `about` = the paper's id, body
//!   `{ "paper": <id>, "standing": "addressee" | "raised" | "affected" | "public" }`;
//! - the `Answer` has the same kind and `about`, and its body is the desk's filing, a `PaperRead` as JSON:
//!   `{ "paper", "standing", "shift": { respect, reason, answers, recourse, threat, appeals: { openness,
//!   conservation, enhancement, transcendence } }, "source" }`; `Null` where the paper was not read (no desk, no
//!   words of its own: the plain paper). `reading_of(answer)` parses it, `None` for anything else. The citizen,
//!   like TS's `readOf`, then ignores a read whose shift `is_no_shift`.
//!
//! Decided fresh:
//! - A multiplier (TS: a float within floor/1000..ceil/1000) is an integer in basis points (10,000 = 1). Every term
//!   is a whole number of basis points, so this is exact, and the bounds are `floor_milli * 10`.
//! - `obey_rate` is exact integer arithmetic with JavaScript's `Math.round` (half up) on the result.
//! - `public_effect`'s weight is in parts per million (1,000,000 = 1), rounded; TS's float differs by under 1e-6.
//! - `fit` is a transient fraction in -1..1 (a float, as `zOf` is in standard deviations): `view_moved` and
//!   `join_moved` round it with `math::round` before anything keeps it. Its sum runs in TS's order (poles, then
//!   each pole's values).
//! - `combine_askings`: the mean of two lines is truncated toward 0, as `Math.trunc` (Rust integer division).
//! - `reading_params` and `reading_dial` return `Err` where TS threw; a size that is not a whole number is an `Err`
//!   too (TS: "a size is a whole number from 0 to 10000").
//! - `words_of` trims as JavaScript's `trim` (spaces of every kind and the byte-order mark).

use super::math;
use super::person::Value;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map};
use std::collections::BTreeMap;

// ------------------------------------------------------------------ readings

/// The four poles of the values a reader returns appeals on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pole {
    Openness,
    Conservation,
    Enhancement,
    Transcendence,
}

/// `POLES`, in TS's order.
pub const POLES: [Pole; 4] = [Pole::Openness, Pole::Conservation, Pole::Enhancement, Pole::Transcendence];

impl Pole {
    pub fn name(self) -> &'static str {
        match self {
            Pole::Openness => "openness",
            Pole::Conservation => "conservation",
            Pole::Enhancement => "enhancement",
            Pole::Transcendence => "transcendence",
        }
    }
}

/// A figure for each pole (0..2 in a reading; a signed step in a shift).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Appeals {
    pub openness: i64,
    pub conservation: i64,
    pub enhancement: i64,
    pub transcendence: i64,
}

impl Appeals {
    pub fn get(&self, p: Pole) -> i64 {
        match p {
            Pole::Openness => self.openness,
            Pole::Conservation => self.conservation,
            Pole::Enhancement => self.enhancement,
            Pole::Transcendence => self.transcendence,
        }
    }
}

/// The lines a reader returns. `answers` is `None` where the paper answers nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reading {
    /// -2..2
    pub respect: i64,
    /// 0..2
    pub reason: i64,
    /// 0..2, or null where nothing was raised
    pub answers: Option<i64>,
    /// 0..2
    pub recourse: i64,
    /// 0..2
    pub threat: i64,
    /// 0..2 each
    pub appeals: Appeals,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Line {
    Respect,
    Reason,
    Answers,
    Recourse,
    Threat,
    Openness,
    Conservation,
    Enhancement,
    Transcendence,
}

/// `LINES`, in TS's order.
pub const LINES: [Line; 9] = [Line::Respect, Line::Reason, Line::Answers, Line::Recourse, Line::Threat, Line::Openness, Line::Conservation, Line::Enhancement, Line::Transcendence];

impl Line {
    pub fn name(self) -> &'static str {
        match self {
            Line::Respect => "respect",
            Line::Reason => "reason",
            Line::Answers => "answers",
            Line::Recourse => "recourse",
            Line::Threat => "threat",
            Line::Openness => "openness",
            Line::Conservation => "conservation",
            Line::Enhancement => "enhancement",
            Line::Transcendence => "transcendence",
        }
    }
    /// `RANGE[l]`: the least and most a reader may say on this line.
    pub fn range(self) -> (i64, i64) {
        match self {
            Line::Respect => (-2, 2),
            _ => (0, 2),
        }
    }
}

/// `RANGE`, as a function of the line.
pub fn range(l: Line) -> (i64, i64) {
    l.range()
}

/// Who the reader of a paper is, to the paper: the only thing of the person a reader is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Standing {
    Addressee,
    Raised,
    Affected,
    Public,
}

/// `STANDINGS`.
pub const STANDINGS: [Standing; 4] = [Standing::Addressee, Standing::Raised, Standing::Affected, Standing::Public];

impl Standing {
    pub fn name(self) -> &'static str {
        match self {
            Standing::Addressee => "addressee",
            Standing::Raised => "raised",
            Standing::Affected => "affected",
            Standing::Public => "public",
        }
    }
}

/// A line's value in a reading (`None` for an unanswered `answers`).
pub fn line_of(r: &Reading, l: Line) -> Option<i64> {
    match l {
        Line::Respect => Some(r.respect),
        Line::Reason => Some(r.reason),
        Line::Answers => r.answers,
        Line::Recourse => Some(r.recourse),
        Line::Threat => Some(r.threat),
        Line::Openness => Some(r.appeals.openness),
        Line::Conservation => Some(r.appeals.conservation),
        Line::Enhancement => Some(r.appeals.enhancement),
        Line::Transcendence => Some(r.appeals.transcendence),
    }
}

/// The plain paper's reading where none is known: nothing said either way.
pub const NEUTRAL: Reading = Reading { respect: 0, reason: 0, answers: None, recourse: 0, threat: 0, appeals: Appeals { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };

/// Whether a reading is whole and in range (a reader's answer that is not is unread).
pub fn well_formed(r: &Reading) -> bool {
    LINES.iter().all(|&l| match line_of(r, l) {
        None => l == Line::Answers,
        Some(v) => v >= l.range().0 && v <= l.range().1,
    })
}

/// A reader's answer as JSON, if it is a whole reading in range (TS's `wellFormed(r: any)`): every line a whole
/// number in range, `answers` a whole number or null, `appeals` an object.
pub fn reading_from_json(v: &serde_json::Value) -> Option<Reading> {
    let obj = v.as_object()?;
    let ap = obj.get("appeals")?.as_object()?;
    let int = |m: &Map<String, serde_json::Value>, k: &str| -> Option<i64> {
        let x = m.get(k)?;
        x.as_i64().or_else(|| x.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9e15).map(|f| f as i64))
    };
    let answers = match obj.get("answers") {
        Some(serde_json::Value::Null) => None,
        _ => Some(int(obj, "answers")?),
    };
    let r = Reading {
        respect: int(obj, "respect")?,
        reason: int(obj, "reason")?,
        answers,
        recourse: int(obj, "recourse")?,
        threat: int(obj, "threat")?,
        appeals: Appeals { openness: int(ap, "openness")?, conservation: int(ap, "conservation")?, enhancement: int(ap, "enhancement")?, transcendence: int(ap, "transcendence")? },
    };
    well_formed(&r).then_some(r)
}

// ------------------------------------------------------------------ the shift

/// The reading less the plain paper's, line by line, in steps. A line either does not have (`answers` of a paper
/// that answers nothing) shifts nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shift {
    pub respect: i64,
    pub reason: i64,
    pub answers: i64,
    pub recourse: i64,
    pub threat: i64,
    pub appeals: Appeals,
}

pub const NO_SHIFT: Shift = Shift { respect: 0, reason: 0, answers: 0, recourse: 0, threat: 0, appeals: Appeals { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };

pub fn shift_of(reading: &Reading, plain: &Reading) -> Shift {
    Shift {
        respect: reading.respect - plain.respect,
        reason: reading.reason - plain.reason,
        answers: match (reading.answers, plain.answers) {
            (Some(a), Some(b)) => a - b,
            _ => 0,
        },
        recourse: reading.recourse - plain.recourse,
        threat: reading.threat - plain.threat,
        appeals: Appeals {
            openness: reading.appeals.openness - plain.appeals.openness,
            conservation: reading.appeals.conservation - plain.appeals.conservation,
            enhancement: reading.appeals.enhancement - plain.appeals.enhancement,
            transcendence: reading.appeals.transcendence - plain.appeals.transcendence,
        },
    }
}

pub fn is_no_shift(s: &Shift) -> bool {
    s.respect == 0 && s.reason == 0 && s.answers == 0 && s.recourse == 0 && s.threat == 0 && POLES.iter().all(|&p| s.appeals.get(p) == 0)
}

/// The readings of the same paper by two askings (the prompt's two wordings), as one: the mean, rounded toward 0; and
/// a line on which the two are more than a step apart is set to the plain paper's and counted (in `LINES` order).
/// `answers` is `None` only where both say so; one saying a number and the other nothing is a line apart.
pub fn combine_askings(a: &Reading, b: &Reading, plain: &Reading) -> (Reading, Vec<Line>) {
    let mut apart: Vec<Line> = Vec::new();
    let mut mean = |l: Line| -> Option<i64> {
        let (x, y, p) = (line_of(a, l), line_of(b, l), line_of(plain, l));
        match (x, y) {
            (None, None) => None,
            (Some(x), Some(y)) if (x - y).abs() <= 1 => Some((x + y) / 2),
            _ => {
                apart.push(l);
                p
            }
        }
    };
    let respect = mean(Line::Respect);
    let reason = mean(Line::Reason);
    let answers = mean(Line::Answers);
    let recourse = mean(Line::Recourse);
    let threat = mean(Line::Threat);
    let openness = mean(Line::Openness);
    let conservation = mean(Line::Conservation);
    let enhancement = mean(Line::Enhancement);
    let transcendence = mean(Line::Transcendence);
    let reading = Reading {
        respect: respect.unwrap_or(0),
        reason: reason.unwrap_or(0),
        answers,
        recourse: recourse.unwrap_or(0),
        threat: threat.unwrap_or(0),
        appeals: Appeals { openness: openness.unwrap_or(0), conservation: conservation.unwrap_or(0), enhancement: enhancement.unwrap_or(0), transcendence: transcendence.unwrap_or(0) },
    };
    (reading, apart)
}

// ------------------------------------------------------------------ the dial and its sizes

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Refusal {
    pub respect_bps: i64,
    pub reason_bps: i64,
    pub answers_bps: i64,
    pub floor_milli: i64,
    pub ceil_milli: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub respect_bps: i64,
    pub floor_milli: i64,
    pub ceil_milli: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Failed {
    pub answers_bps: i64,
    pub recourse_bps: i64,
    pub floor_milli: i64,
    pub ceil_milli: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DoneTo {
    pub reason_bps: i64,
    pub recourse_bps: i64,
    pub floor_milli: i64,
    pub ceil_milli: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicSizes {
    pub respect_bps: i64,
    pub reason_bps: i64,
    pub answers_bps: i64,
    pub weight_raised_bps: i64,
    pub weight_affected_bps: i64,
    pub weight_public_bps: i64,
}

/// The sizes of how each line lands (docs/design/ai-citizens.md 13b). Coefficients are basis points of a multiplier
/// (2,000: 0.20 for each step); the bounds are multipliers in thousandths so a world config holds whole numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadingParams {
    /// Trust in whoever decided: a refusal or a loss. The weight times 1 - respect*a - reason*b - answers*c.
    pub refusal: Refusal,
    /// The same, on a grant: times 1 + respect*a.
    pub grant: Grant,
    /// Sense of agency, on something tried that failed: times 1 - answers*a - recourse*b.
    pub failed: Failed,
    /// Sense of agency, on something done to the person: times 1 - reason*a - recourse*b.
    pub done_to: DoneTo,
    /// Anger toward the writer by each step of respect below the plain paper's; fear by each step of threat above.
    pub anger_bps: i64,
    pub fear_bps: i64,
    /// The tie with the writer, a step of respect.
    pub tie_bps: i64,
    /// The odds of appealing: the score of the ways that answer the paper, up this much a step of recourse.
    pub recourse_score_bps: i64,
    /// The odds of complying with an order: the rate swayed by (respect + reason) at this share a step, at most
    /// `obey_max_bps` of the rate either way.
    pub obey_per_bps: i64,
    pub obey_max_bps: i64,
    /// A public paper, for each person it reaches (step 6).
    pub public: PublicSizes,
    /// What the reader thinks of the writer, and the odds of joining a founded thing, by the fit (step 6).
    pub view_bps: i64,
    pub join_bps: i64,
}

pub const READING_DEFAULTS: ReadingParams = ReadingParams {
    refusal: Refusal { respect_bps: 2_000, reason_bps: 1_500, answers_bps: 1_000, floor_milli: 400, ceil_milli: 1_600 },
    grant: Grant { respect_bps: 1_000, floor_milli: 800, ceil_milli: 1_200 },
    failed: Failed { answers_bps: 1_500, recourse_bps: 1_000, floor_milli: 500, ceil_milli: 1_250 },
    done_to: DoneTo { reason_bps: 1_000, recourse_bps: 1_000, floor_milli: 600, ceil_milli: 1_200 },
    anger_bps: 1_000,
    fear_bps: 1_500,
    tie_bps: 500,
    recourse_score_bps: 500,
    obey_per_bps: 500,
    obey_max_bps: 1_500,
    public: PublicSizes { respect_bps: 4_000, reason_bps: 3_000, answers_bps: 3_000, weight_raised_bps: 5_000, weight_affected_bps: 3_000, weight_public_bps: 1_000 },
    view_bps: 800,
    join_bps: 750,
};

impl Default for ReadingParams {
    fn default() -> Self {
        READING_DEFAULTS
    }
}

/// The most a multiplier on a decision's weight may reach above 1 (in thousandths: 2.0), and the least it may keep
/// of it (0.1). A word's bound (Naz, 2026-10-13): the effect of how a paper is put is within the effect of what it
/// decides.
pub const FLOOR_MIN_MILLI: i64 = 100;
pub const CEIL_MAX_MILLI: i64 = 2_000;

/// `{...base, ...over}` for one section: `over`'s keys over `base`'s, as JSON.
fn merged<T: Serialize + for<'de> Deserialize<'de>>(base: &T, over: Option<&serde_json::Value>, path: &str) -> Result<T, String> {
    let mut v = serde_json::to_value(base).map_err(|e| e.to_string())?;
    if let (Some(o), Some(m)) = (over.and_then(|o| o.as_object()), v.as_object_mut()) {
        for (k, x) in o {
            if m.contains_key(k) {
                m.insert(k.clone(), x.clone());
            }
        }
    }
    serde_json::from_value(v).map_err(|_| format!("dials.reading.step.{path}: a size is a whole number from 0 to 10000"))
}

/// A top-level size: the given one, else the default (`g.x ?? d.x`).
fn size(g: &serde_json::Value, key: &str, d: i64) -> Result<i64, String> {
    match g.get(key) {
        None | Some(serde_json::Value::Null) => Ok(d),
        Some(x) => x.as_i64().ok_or_else(|| format!("dials.reading.step.{key}: a size is a whole number from 0 to 10000; got {x}")),
    }
}

/// The sizes a world gives, over the defaults. **Refuses** any setting that would let words reverse or outweigh a
/// decision: a multiplier's floor below 0.1 (so a refusal could cost nothing) or its ceiling above 2 (so the words
/// could outweigh the decision), a floor above 1 and a ceiling below 1, and any negative or fractional size.
pub fn reading_params(given: &serde_json::Value) -> Result<ReadingParams, String> {
    let d = READING_DEFAULTS;
    let g = given;
    let p = ReadingParams {
        refusal: merged(&d.refusal, g.get("refusal"), "refusal")?,
        grant: merged(&d.grant, g.get("grant"), "grant")?,
        failed: merged(&d.failed, g.get("failed"), "failed")?,
        done_to: merged(&d.done_to, g.get("done_to"), "done_to")?,
        anger_bps: size(g, "anger_bps", d.anger_bps)?,
        fear_bps: size(g, "fear_bps", d.fear_bps)?,
        tie_bps: size(g, "tie_bps", d.tie_bps)?,
        recourse_score_bps: size(g, "recourse_score_bps", d.recourse_score_bps)?,
        obey_per_bps: size(g, "obey_per_bps", d.obey_per_bps)?,
        obey_max_bps: size(g, "obey_max_bps", d.obey_max_bps)?,
        public: merged(&d.public, g.get("public"), "public")?,
        view_bps: size(g, "view_bps", d.view_bps)?,
        join_bps: size(g, "join_bps", d.join_bps)?,
    };
    for (name, floor, ceil) in [
        ("refusal", p.refusal.floor_milli, p.refusal.ceil_milli),
        ("grant", p.grant.floor_milli, p.grant.ceil_milli),
        ("failed", p.failed.floor_milli, p.failed.ceil_milli),
        ("done_to", p.done_to.floor_milli, p.done_to.ceil_milli),
    ] {
        if !((FLOOR_MIN_MILLI..=1_000).contains(&floor) && (1_000..=CEIL_MAX_MILLI).contains(&ceil)) {
            return Err(format!("dials.reading.step.{name}: words may scale what a decision does and never reverse or outweigh it: floor must be {FLOOR_MIN_MILLI}..1000 and ceiling 1000..{CEIL_MAX_MILLI} (thousandths); got {floor}..{ceil}"));
        }
    }
    let sizes: [(&str, i64); 22] = [
        ("refusal.respect_bps", p.refusal.respect_bps),
        ("refusal.reason_bps", p.refusal.reason_bps),
        ("refusal.answers_bps", p.refusal.answers_bps),
        ("grant.respect_bps", p.grant.respect_bps),
        ("failed.answers_bps", p.failed.answers_bps),
        ("failed.recourse_bps", p.failed.recourse_bps),
        ("done_to.reason_bps", p.done_to.reason_bps),
        ("done_to.recourse_bps", p.done_to.recourse_bps),
        ("anger_bps", p.anger_bps),
        ("fear_bps", p.fear_bps),
        ("tie_bps", p.tie_bps),
        ("recourse_score_bps", p.recourse_score_bps),
        ("obey_per_bps", p.obey_per_bps),
        ("obey_max_bps", p.obey_max_bps),
        ("public.respect_bps", p.public.respect_bps),
        ("public.reason_bps", p.public.reason_bps),
        ("public.answers_bps", p.public.answers_bps),
        ("public.weight_raised_bps", p.public.weight_raised_bps),
        ("public.weight_affected_bps", p.public.weight_affected_bps),
        ("public.weight_public_bps", p.public.weight_public_bps),
        ("view_bps", p.view_bps),
        ("join_bps", p.join_bps),
    ];
    for (n, v) in sizes {
        if !(0..=10_000).contains(&v) {
            return Err(format!("dials.reading.step.{n}: a size is a whole number from 0 to 10000; got {v}"));
        }
    }
    if p.obey_max_bps > 5_000 {
        return Err(format!("dials.reading.step.obey_max_bps: words move the odds of complying by at most half the rate either way; got {}", p.obey_max_bps));
    }
    // The weights of a public paper are at most half a decision's: words in public never outweigh a deed.
    for w in [p.public.weight_raised_bps, p.public.weight_affected_bps, p.public.weight_public_bps] {
        if w > 5_000 {
            return Err("dials.reading.step.public: a public paper counts at most half a decision's weight to anyone".into());
        }
    }
    Ok(p)
}

/// The world's dial, if it is on: `dials.reading` with its sizes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadingDial {
    /// Which kinds of paper are read: "decision", "public", "founding".
    pub papers: Vec<String>,
    pub reader: String,
    pub calls_per_run: i64,
    pub params: ReadingParams,
}

/// `readingDial(world)`: `world` is the world's config as JSON (`dials.reading`). Absent: `Ok(None)` (the dial is
/// off, no site is entered).
pub fn reading_dial(world: &serde_json::Value) -> Result<Option<ReadingDial>, String> {
    let Some(d) = world.get("dials").and_then(|d| d.get("reading")).filter(|d| d.is_object()) else { return Ok(None) };
    let papers = match d.get("papers") {
        Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        _ => vec!["decision".to_string()],
    };
    let reader = match d.get("reader") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Null) | None => String::new(),
        Some(x) => x.to_string(),
    };
    let calls_per_run = d.get("calls_per_run").and_then(|x| x.as_i64()).unwrap_or(800);
    let params = reading_params(d.get("step").unwrap_or(&serde_json::Value::Null))?;
    Ok(Some(ReadingDial { papers, reader, calls_per_run, params }))
}

// ------------------------------------------------------------------ how each line lands

/// A multiplier in basis points (10,000 = 1) held within floor..ceil thousandths.
fn mult(bps: i64, floor_milli: i64, ceil_milli: i64) -> i64 {
    bps.clamp(floor_milli * 10, ceil_milli * 10)
}

/// The weight of a refusal's or loss's cost to trust, times this (basis points): 1 - respect*a - reason*b - answers*c.
pub fn refusal_trust(s: &Shift, p: &ReadingParams) -> i64 {
    mult(10_000 - (s.respect * p.refusal.respect_bps + s.reason * p.refusal.reason_bps + s.answers * p.refusal.answers_bps), p.refusal.floor_milli, p.refusal.ceil_milli)
}
/// A grant's contribution to trust, times this (basis points).
pub fn grant_trust(s: &Shift, p: &ReadingParams) -> i64 {
    mult(10_000 + s.respect * p.grant.respect_bps, p.grant.floor_milli, p.grant.ceil_milli)
}
/// The cost to the sense of agency of something tried that failed, times this (basis points).
pub fn failed_agency(s: &Shift, p: &ReadingParams) -> i64 {
    mult(10_000 - (s.answers * p.failed.answers_bps + s.recourse * p.failed.recourse_bps), p.failed.floor_milli, p.failed.ceil_milli)
}
/// The cost to the sense of agency of something done to the person, times this (basis points).
pub fn done_to_agency(s: &Shift, p: &ReadingParams) -> i64 {
    mult(10_000 - (s.reason * p.done_to.reason_bps + s.recourse * p.done_to.recourse_bps), p.done_to.floor_milli, p.done_to.ceil_milli)
}
/// Anger at the writer to add (basis points of the way to the most), per step of respect below the plain paper's.
pub fn anger_added(s: &Shift, p: &ReadingParams) -> i64 {
    (-s.respect).max(0) * p.anger_bps
}
/// Fear of the writer to add, for each step of threat above the plain paper's; none below.
pub fn fear_added(s: &Shift, p: &ReadingParams) -> i64 {
    s.threat.max(0) * p.fear_bps
}
/// The tie with the writer, moved by this (signed).
pub fn tie_moved(s: &Shift, p: &ReadingParams) -> i64 {
    s.respect * p.tie_bps
}
/// The score of a way that answering the paper (asking its writer again; a venue that hears the matter) is up by this.
pub fn recourse_score(s: &Shift, p: &ReadingParams) -> i64 {
    s.recourse * p.recourse_score_bps
}
/// The odds of complying, swayed: the rate times 1 + (respect + reason) * per, at most `obey_max` of the rate either
/// way. Same draw, other threshold. Exact integers, half up.
pub fn obey_rate(bps: i64, s: &Shift, p: &ReadingParams) -> i64 {
    let f = ((s.respect + s.reason) * p.obey_per_bps).clamp(-p.obey_max_bps, p.obey_max_bps);
    let x = bps as i128 * (10_000 + f as i128);
    // Math.round: half toward +infinity.
    let r = (2 * x + 10_000).div_euclid(20_000);
    (r as i64).clamp(0, 10_000)
}

/// What a public paper is to someone it reaches (step 6): good or bad by the sign of the sum, its weight the sum's
/// size (at most 1) times the share of their standing. `weight_ppm` is in parts per million.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicEffect {
    pub good: bool,
    pub weight_ppm: i64,
}

pub fn public_effect(s: &Shift, standing: Standing, p: &ReadingParams) -> Option<PublicEffect> {
    // The sum in basis points of a step (TS: that over 10,000).
    let sum = s.respect * p.public.respect_bps + s.reason * p.public.reason_bps + s.answers * p.public.answers_bps;
    if sum == 0 {
        return None;
    }
    let share = match standing {
        Standing::Raised => p.public.weight_raised_bps,
        Standing::Affected => p.public.weight_affected_bps,
        Standing::Public => p.public.weight_public_bps,
        Standing::Addressee => 10_000,
    };
    let size = sum.abs().min(10_000);
    // size/10,000 x share/10,000 = size x share / 1e8, in millionths: size x share / 100, rounded half up.
    let ppm = (size * share + 50).div_euclid(100);
    Some(PublicEffect { good: sum > 0, weight_ppm: ppm })
}

// ------------------------------------------------------------------ appeals: the fit of a paper to a person's values

/// The ten values grouped as Schwartz groups them into four poles (hedonism sits between openness and enhancement
/// and counts in both).
pub fn pole_values(p: Pole) -> &'static [Value] {
    match p {
        Pole::Openness => &[Value::SelfDirection, Value::Stimulation, Value::Hedonism],
        Pole::Enhancement => &[Value::Achievement, Value::Power, Value::Hedonism],
        Pole::Conservation => &[Value::Security, Value::Conformity, Value::Tradition],
        Pole::Transcendence => &[Value::Universalism, Value::Benevolence],
    }
}

/// How well a paper's appeals fit one person: each pole's appeal (0..2) times how far this person's own values on it
/// sit from the town's (`z_of`, in standard deviations, the mean over the pole's values), summed, over 4, within -1
/// and 1. Pass the appeals (the reading's, or the shift of them: step 6 reads the shift). A transient fraction.
pub fn fit(appeals: &Appeals, z_of: impl Fn(Value) -> f64) -> f64 {
    let mut s = 0.0;
    for p in POLES {
        let vs = pole_values(p);
        let mut sum = 0.0;
        for &v in vs {
            sum += z_of(v);
        }
        s += appeals.get(p) as f64 * (sum / vs.len() as f64);
    }
    (s / 4.0).clamp(-1.0, 1.0)
}

/// What the reader thinks of the writer moves by this (step 6).
pub fn view_moved(f: f64, p: &ReadingParams) -> i64 {
    math::round(f * p.view_bps as f64)
}
/// The score of joining a founded thing moves by this (step 6).
pub fn join_moved(f: f64, p: &ReadingParams) -> i64 {
    math::round(f * p.join_bps as f64)
}

// ------------------------------------------------------------------ which papers carry a seat's own words

/// The kinds of paper that are a decision addressed to a person (the first slice, design 13a): each has a field for
/// words.
pub const DECISION_KINDS: [&str; 7] = ["variation_answer", "remedy_answer", "venue_decision", "tribunal_order", "fund_decision", "loan_decision", "benefit_decision"];
/// The fields of a paper's `data` that carry the writer's own words, in this order.
pub const WORD_FIELDS: [&str; 4] = ["reason", "statement", "answer", "why"];

fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// The writer's own words on a paper, if it has any: the text fields of its data (a JSON object), trimmed and
/// joined with a newline, in the order `WORD_FIELDS` lists them.
pub fn words_of(data: &serde_json::Value) -> Option<String> {
    let parts: Vec<&str> = WORD_FIELDS.iter().filter_map(|f| data.get(f).and_then(|x| x.as_str())).map(js_trim).filter(|s| !s.is_empty()).collect();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

/// What a decision decided, in a word: the key of its plain paper in the table (`kind:outcome`).
pub fn plain_key(kind: &str, data: &serde_json::Value) -> String {
    let yes = data.get("granted").filter(|x| !x.is_null()).or_else(|| data.get("approved"));
    let outcome = match yes {
        Some(serde_json::Value::Bool(b)) => (if *b { "granted" } else { "refused" }).to_string(),
        _ => match data.get("finding") {
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => "decided".to_string(),
        },
    };
    format!("{kind}:{outcome}")
}

/// What the desk files for a paper and a standing, and the citizen reads: the shift, how it came about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperRead {
    pub paper: String,
    pub standing: Standing,
    pub shift: Shift,
    pub source: String,
}

/// One figure that a reading moved: what it came to, what it would have been on the plain paper, and before.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Moved {
    pub after: i64,
    pub plain: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<i64>,
}

/// The figures a person's record keeps of one reading (the `read` of an outcome's facts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadFacts {
    pub paper: String,
    pub source: String,
    pub shift: Shift,
    pub moved: BTreeMap<String, Moved>,
}

pub fn read_facts(rd: &PaperRead, moved: BTreeMap<String, Moved>) -> ReadFacts {
    ReadFacts { paper: rd.paper.clone(), source: rd.source.clone(), shift: rd.shift, moved }
}

/// What a tribunal's order or a venue's decision can find (the forms' options, papers.ts).
pub const FINDINGS: [&str; 12] = ["dismissed", "rejected", "pay", "do", "set_aside", "settled", "referred", "plan", "possession", "valid", "invalid", "paid"];

/// Every key of the table of plain papers: each kind of decision by each outcome it can state.
pub fn plain_keys() -> Vec<String> {
    let mut out = Vec::new();
    for k in DECISION_KINDS {
        let outcomes: &[&str] = if k == "tribunal_order" || k == "venue_decision" { &FINDINGS } else { &["granted", "refused"] };
        for o in outcomes {
            out.push(format!("{k}:{o}"));
        }
    }
    out
}

// ------------------------------------------------------------------ the seam: asking the desk

/// The kind of question and answer (see the top of the file).
pub const READING_KIND: &str = "reading";

/// The question the citizen asks for a paper's reading (TS: `ctx.read(paper, standing)`); the citizen asks with
/// `Standing::Addressee` for a decision that reached it.
pub fn reading_question(paper_id: &str, standing: Standing) -> crate::Question {
    crate::Question { kind: READING_KIND.into(), about: paper_id.into(), body: json!({ "paper": paper_id, "standing": standing.name() }) }
}

/// The reading in an answer to `reading_question`: `None` for another kind of answer, for no answer (a `Null` body:
/// the paper was not read) or for a body that is not a whole `PaperRead`. A read whose shift `is_no_shift` is for
/// the caller to ignore (as TS's `readOf`).
pub fn reading_of(answer: &crate::Answer) -> Option<PaperRead> {
    if answer.kind != READING_KIND || answer.body.is_null() {
        return None;
    }
    serde_json::from_value(answer.body.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rd(respect: i64, reason: i64, answers: Option<i64>, recourse: i64, threat: i64) -> Reading {
        Reading { respect, reason, answers, recourse, threat, appeals: NEUTRAL.appeals }
    }

    /// Every reading a reader can return on the five main lines (answers null or 0..2), appeals all 0.
    fn all() -> Vec<Reading> {
        let mut v = Vec::new();
        for respect in -2..=2 {
            for reason in 0..=2 {
                for answers in [None, Some(0), Some(1), Some(2)] {
                    for recourse in 0..=2 {
                        for threat in 0..=2 {
                            v.push(rd(respect, reason, answers, recourse, threat));
                        }
                    }
                }
            }
        }
        v
    }

    fn shifts() -> Vec<Shift> {
        let mut seen = BTreeMap::new();
        let a = all();
        for r in &a {
            for plain in &a {
                let s = shift_of(r, plain);
                seen.insert((s.respect, s.reason, s.answers, s.recourse, s.threat), s);
            }
        }
        seen.into_values().collect()
    }

    #[test]
    fn no_shift_gives_todays_figures() {
        let p = READING_DEFAULTS;
        assert!(is_no_shift(&NO_SHIFT));
        for m in [refusal_trust(&NO_SHIFT, &p), grant_trust(&NO_SHIFT, &p), failed_agency(&NO_SHIFT, &p), done_to_agency(&NO_SHIFT, &p)] {
            assert_eq!(m, 10_000);
        }
        assert_eq!(anger_added(&NO_SHIFT, &p) + fear_added(&NO_SHIFT, &p) + tie_moved(&NO_SHIFT, &p) + recourse_score(&NO_SHIFT, &p), 0);
        assert_eq!(obey_rate(7_300, &NO_SHIFT, &p), 7_300);
        assert_eq!(public_effect(&NO_SHIFT, Standing::Raised, &p), None);
    }

    #[test]
    fn every_multiplier_stays_within_its_bounds() {
        let p = READING_DEFAULTS;
        let ss = shifts();
        assert!(ss.len() > 500);
        for s in &ss {
            assert!((4_000..=16_000).contains(&refusal_trust(s, &p)));
            assert!((8_000..=12_000).contains(&grant_trust(s, &p)));
            assert!((5_000..=12_500).contains(&failed_agency(s, &p)));
            assert!((6_000..=12_000).contains(&done_to_agency(s, &p)));
            let o = obey_rate(5_000, s, &p);
            assert!((4_250 - 1..=5_750 + 1).contains(&o));
        }
    }

    #[test]
    fn every_setting_the_dial_accepts_keeps_words_within_the_decision() {
        // The multiplier never leaves [floor, ceil], and floor <= 1 <= ceil, so a refusal still costs and a grant
        // still counts, and the words' part is within the decision's own (ceil - 1 <= 1).
        for floor in [100, 400, 1_000] {
            for ceil in [1_000, 1_600, 2_000] {
                let p = reading_params(&json!({
                    "refusal": { "floor_milli": floor, "ceil_milli": ceil, "respect_bps": 10_000, "reason_bps": 10_000, "answers_bps": 10_000 },
                    "grant": { "floor_milli": floor, "ceil_milli": ceil, "respect_bps": 10_000 },
                    "failed": { "floor_milli": floor, "ceil_milli": ceil, "answers_bps": 10_000, "recourse_bps": 10_000 },
                    "done_to": { "floor_milli": floor, "ceil_milli": ceil, "reason_bps": 10_000, "recourse_bps": 10_000 },
                }))
                .unwrap();
                for s in shifts() {
                    for (m, f, c) in [
                        (refusal_trust(&s, &p), floor, ceil),
                        (grant_trust(&s, &p), floor, ceil),
                        (failed_agency(&s, &p), floor, ceil),
                        (done_to_agency(&s, &p), floor, ceil),
                    ] {
                        assert!(m >= f * 10 && m <= c * 10);
                        assert!(m > 0 && m <= 20_000);
                    }
                }
            }
        }
    }

    #[test]
    fn a_setting_that_would_let_words_reverse_or_outweigh_a_decision_is_refused() {
        let err = |v: serde_json::Value| reading_params(&v).unwrap_err();
        assert!(err(json!({ "refusal": { "floor_milli": 0 } })).contains("never reverse or outweigh"));
        assert!(err(json!({ "refusal": { "ceil_milli": 2_500 } })).contains("never reverse or outweigh"));
        assert!(err(json!({ "grant": { "floor_milli": 1_200 } })).contains("never reverse or outweigh"));
        assert!(err(json!({ "done_to": { "ceil_milli": 900 } })).contains("never reverse or outweigh"));
        assert!(err(json!({ "obey_max_bps": 6_000 })).contains("at most half"));
        assert!(err(json!({ "public": { "weight_raised_bps": 9_000 } })).contains("at most half"));
        assert!(err(json!({ "tie_bps": -5 })).contains("whole number"));
        assert_eq!(reading_params(&json!({})).unwrap().refusal.floor_milli, 400);
        assert_eq!(reading_params(&json!({})).unwrap(), READING_DEFAULTS);
    }

    #[test]
    fn the_worked_example_of_13b_a_refusal_put_two_ways() {
        let plain = rd(0, 1, Some(1), 0, 0);
        let humane = rd(1, 2, Some(2), 2, 0);
        let curt = rd(-2, 0, Some(0), 0, 0);
        let p = READING_DEFAULTS;
        let (h, c) = (shift_of(&humane, &plain), shift_of(&curt, &plain));
        assert_eq!((h.respect, h.reason, h.answers, h.recourse, h.threat), (1, 1, 1, 2, 0));
        assert_eq!(refusal_trust(&h, &p), 5_500);
        assert_eq!(refusal_trust(&c, &p), 16_000); // 1.65, held
        assert_eq!(failed_agency(&h, &p), 6_500);
        assert_eq!(failed_agency(&c, &p), 11_500);
        assert_eq!(anger_added(&c, &p), 2_000);
        assert_eq!(tie_moved(&c, &p), -1_000);
        assert_eq!(recourse_score(&h, &p), 1_000);
    }

    #[test]
    fn obeying_is_swayed_either_way_and_rounds_half_up() {
        let p = READING_DEFAULTS;
        let kind = shift_of(&rd(2, 2, None, 0, 0), &rd(0, 0, None, 0, 0)); // 4 steps x 5% = +20%, held to +15%
        let curt = shift_of(&rd(-2, 0, None, 0, 0), &rd(0, 0, None, 0, 0)); // -10%
        assert_eq!(obey_rate(5_000, &kind, &p), 5_750);
        assert_eq!(obey_rate(5_000, &curt, &p), 4_500);
        assert_eq!(obey_rate(10_000, &kind, &p), 10_000);
        assert_eq!(obey_rate(5, &curt, &p), 5); // 4.5 rounds up to 5
        assert_eq!(obey_rate(0, &kind, &p), 0);
    }

    #[test]
    fn a_public_papers_effect_is_the_stated_weight_and_never_more_than_half() {
        let p = READING_DEFAULTS;
        let plain = rd(0, 1, Some(1), 0, 0);
        let kind = rd(1, 2, Some(2), 1, 0);
        let e = public_effect(&shift_of(&kind, &plain), Standing::Raised, &p).unwrap();
        assert!(e.good);
        assert_eq!(e.weight_ppm, 500_000);
        let brush = rd(-1, 0, Some(0), 0, 0);
        assert!(!public_effect(&shift_of(&brush, &plain), Standing::Raised, &p).unwrap().good);
        let a = all();
        for r in &a {
            for q in a.iter().step_by(17) {
                for st in [Standing::Raised, Standing::Affected, Standing::Public] {
                    if let Some(x) = public_effect(&shift_of(r, q), st, &p) {
                        assert!(x.weight_ppm <= 500_000);
                    }
                }
            }
        }
    }

    #[test]
    fn the_fit_is_the_worked_example_and_stays_in_range() {
        let z = |v: Value| match v {
            Value::Security | Value::Conformity | Value::Tradition => 1.2,
            Value::Universalism | Value::Benevolence => 0.3,
            _ => 0.0,
        };
        let f = fit(&Appeals { openness: 0, conservation: 2, enhancement: 0, transcendence: 1 }, z);
        assert!((f - 0.675).abs() < 1e-12);
        // Within -1 and 1 however far the person stands.
        let far = fit(&Appeals { openness: 2, conservation: 2, enhancement: 2, transcendence: 2 }, |_| 9.0);
        assert_eq!(far, 1.0);
        assert_eq!(fit(&Appeals { openness: 2, conservation: 2, enhancement: 2, transcendence: 2 }, |_| -9.0), -1.0);
        assert_eq!(view_moved(0.675, &READING_DEFAULTS), 540);
        assert_eq!(join_moved(-0.5, &READING_DEFAULTS), -375);
        // Hedonism counts in both of its poles.
        assert_eq!(fit(&Appeals { openness: 2, conservation: 0, enhancement: 0, transcendence: 0 }, |v| if v == Value::Hedonism { 3.0 } else { 0.0 }), 0.5);
    }

    #[test]
    fn two_askings_the_mean_toward_0_and_a_line_apart_is_the_plain_papers() {
        let plain = rd(0, 1, Some(1), 0, 0);
        let (r, apart) = combine_askings(&rd(1, 2, Some(2), 0, 0), &rd(2, 0, Some(2), 0, 0), &plain);
        assert_eq!(r.respect, 1); // (1+2)/2 = 1.5 toward 0
        assert_eq!(r.reason, 1); // 2 and 0 are two apart: plain's
        assert_eq!(r.answers, Some(2));
        assert_eq!(apart, vec![Line::Reason]);
        assert_eq!(combine_askings(&rd(-1, 0, None, 0, 0), &rd(-2, 0, None, 0, 0), &plain).0.respect, -1);
        assert_eq!(combine_askings(&rd(0, 0, None, 0, 0), &rd(0, 0, Some(1), 0, 0), &plain).1, vec![Line::Answers]);
        assert!(well_formed(&r));
        assert!(!well_formed(&Reading { respect: 3, ..r }));
        assert_eq!(LINES.len(), 9);
        assert_eq!(range(Line::Respect), (-2, 2));
        assert_eq!(POLES.len(), 4);
    }

    #[test]
    fn a_readers_answer_is_checked_as_json() {
        let good = json!({ "respect": -1, "reason": 2, "answers": null, "recourse": 0, "threat": 1, "appeals": { "openness": 0, "conservation": 1, "enhancement": 0, "transcendence": 2 } });
        let r = reading_from_json(&good).unwrap();
        assert_eq!((r.respect, r.answers, r.appeals.transcendence), (-1, None, 2));
        let mut bad = good.clone();
        bad["respect"] = json!(3);
        assert!(reading_from_json(&bad).is_none());
        bad["respect"] = json!(0.5);
        assert!(reading_from_json(&bad).is_none());
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("answers");
        assert!(reading_from_json(&missing).is_none());
        assert!(reading_from_json(&json!({ "respect": 0 })).is_none());
    }

    #[test]
    fn the_dial_absent_is_off_present_is_read_over_the_defaults() {
        assert_eq!(reading_dial(&json!(null)).unwrap(), None);
        assert_eq!(reading_dial(&json!({})).unwrap(), None);
        assert_eq!(reading_dial(&json!({ "dials": { "initiative_bps": 10_000 } })).unwrap(), None);
        let d = reading_dial(&json!({ "dials": { "reading": { "reader": "mock" } } })).unwrap().unwrap();
        assert_eq!(d.papers, ["decision"]);
        assert_eq!((d.calls_per_run, d.reader.as_str()), (800, "mock"));
        assert_eq!(d.params, READING_DEFAULTS);
        let t = reading_dial(&json!({ "dials": { "reading": { "reader": "mock", "step": { "tie_bps": 100 }, "papers": ["decision", "public"], "calls_per_run": 12 } } })).unwrap().unwrap();
        assert_eq!((t.params.tie_bps, t.calls_per_run, t.papers.len()), (100, 12, 2));
        assert!(reading_dial(&json!({ "dials": { "reading": { "reader": "mock", "step": { "refusal": { "floor_milli": 0 } } } } })).is_err());
    }

    #[test]
    fn papers_words_and_plain_keys() {
        assert_eq!(words_of(&json!({ "reason": "  No.  ", "why": "Because", "answer": "", "statement": 4 })).as_deref(), Some("No.\nBecause"));
        assert_eq!(words_of(&json!({ "reason": "  " })), None);
        assert_eq!(plain_key("loan_decision", &json!({ "approved": false })), "loan_decision:refused");
        assert_eq!(plain_key("fund_decision", &json!({ "granted": true, "approved": false })), "fund_decision:granted");
        assert_eq!(plain_key("tribunal_order", &json!({ "finding": "pay" })), "tribunal_order:pay");
        assert_eq!(plain_key("tribunal_order", &json!({})), "tribunal_order:decided");
        let keys = plain_keys();
        assert_eq!(keys.len(), 5 * 2 + 2 * 12);
        assert_eq!(keys[0], "variation_answer:granted");
        assert!(keys.contains(&"venue_decision:possession".to_string()));
    }

    #[test]
    fn the_citizen_asks_the_desk_and_reads_what_comes_back() {
        let q = reading_question("rec.12", Standing::Addressee);
        assert_eq!((q.kind.as_str(), q.about.as_str()), ("reading", "rec.12"));
        assert_eq!(q.body, json!({ "paper": "rec.12", "standing": "addressee" }));
        let filed = PaperRead { paper: "rec.12".into(), standing: Standing::Addressee, shift: shift_of(&rd(-2, 0, Some(0), 0, 1), &rd(0, 1, Some(1), 0, 0)), source: "model".into() };
        let answer = crate::Answer { kind: q.kind.clone(), about: q.about.clone(), body: serde_json::to_value(&filed).unwrap() };
        assert_eq!(reading_of(&answer), Some(filed));
        assert_eq!(reading_of(&crate::Answer { kind: "reading".into(), about: "rec.12".into(), body: serde_json::Value::Null }), None);
        assert_eq!(reading_of(&crate::Answer { kind: "other".into(), about: "rec.12".into(), body: answer.body.clone() }), None);
        assert_eq!(reading_of(&crate::Answer { kind: "reading".into(), about: "x".into(), body: json!({ "paper": "x" }) }), None);
    }

    #[test]
    fn facts_and_a_saved_reading_round_trip() {
        let filed = PaperRead { paper: "p".into(), standing: Standing::Public, shift: NO_SHIFT, source: "cache".into() };
        let mut moved = BTreeMap::new();
        moved.insert("trust".to_string(), Moved { after: 5_028, plain: 4_888, before: Some(5_200) });
        moved.insert("anger".to_string(), Moved { after: 100, plain: 0, before: None });
        let facts = read_facts(&filed, moved);
        let v = serde_json::to_value(&facts).unwrap();
        assert_eq!(v["moved"]["anger"], json!({ "after": 100, "plain": 0 }));
        let back: ReadFacts = serde_json::from_value(v).unwrap();
        assert_eq!(back, facts);
        let p: ReadingParams = serde_json::from_value(serde_json::to_value(READING_DEFAULTS).unwrap()).unwrap();
        assert_eq!(p, READING_DEFAULTS);
        let d = reading_dial(&json!({ "dials": { "reading": { "reader": "m" } } })).unwrap().unwrap();
        let d2: ReadingDial = serde_json::from_value(serde_json::to_value(&d).unwrap()).unwrap();
        assert_eq!(d, d2);
    }
}
