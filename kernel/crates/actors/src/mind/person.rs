//! participants/src/behaviour/mind.ts, in Rust (lane A2): who someone is, how satisfied, how they learn and decide,
//! their feelings and ties (docs/design/ai-citizens.md 3; docs/behaviour/citizen.md).
//!
//! The shared names (values, needs, emotions) are at the top: every part of the mind uses them.
//!
//! Decided fresh in the port (where TS leaned on JavaScript or kept floats):
//! - Rounding is `math::round` (JavaScript's `Math.round`, half up) wherever TS rounded; integer ratios TS rounded
//!   (certainty, a per-month amount, work seconds to hours) are rounded half up in integers, which is the same.
//! - An attraction (EWA) is kept in millionths of a basis point (`FINE`), the experience weight `n` in billionths
//!   (`N_SCALE`): TS kept both as floats. Each update computes in f64 from the stored integers and rounds back, so the
//!   attraction is TS's to well under a millionth of a basis point and a saved mind steps exactly as before. `get`
//!   returns the attraction rounded to a basis point; `attraction` the fine figure; `choose` and the scores use the
//!   fine one, as TS used the float.
//! - EWA's `lambda` is a parameter TS took as a number: kept in thousandths (`lambda_milli`), read and written as the
//!   number (`"lambda": 4`), so a saved mind restores it exactly.
//! - A normal draw (Irwin-Hall) sums the twelve integer draws first and divides once: TS summed twelve quotients,
//!   which differs by about 1e-15, never enough to move a rounding but at an exact half.
//! - `log1p` is `math::ln(1 + x)`; `Math.pow`/`Math.exp` are `math::pow`/`math::exp`.
//! - JavaScript's falsy 0: where TS wrote `f.x ? ... : 0` an `Some(0)` counts as absent, as 0 did.
//! - Orders: options are sorted by key (byte order, a stable sort); maps are `BTreeMap` (no TS outcome depended on a
//!   Map's insertion order here: EWA iterates sorted keys, ties sort by affinity then id, feelings by their key).
//! - `Attractions::choose` with no options returns an empty key without a draw (TS would have thrown).
//! - `NeedLevels` is `Needs` (every need judged); an `Appraisal` is `[Option<i64>; 7]` (TS's optional keys).
//! - `Facts`, `Choice` and `Decision` are this file's own (the citizen's seam has its own; the lead converts).

use oikos_core::rng::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use super::math;

/// Schwartz's ten basic values (mind.ts `VALUES`), in TS's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Value {
    SelfDirection,
    Stimulation,
    Hedonism,
    Achievement,
    Power,
    Security,
    Conformity,
    Tradition,
    Benevolence,
    Universalism,
}

impl Value {
    pub const ALL: [Value; 10] = [
        Value::SelfDirection,
        Value::Stimulation,
        Value::Hedonism,
        Value::Achievement,
        Value::Power,
        Value::Security,
        Value::Conformity,
        Value::Tradition,
        Value::Benevolence,
        Value::Universalism,
    ];
    pub fn name(self) -> &'static str {
        match self {
            Value::SelfDirection => "self_direction",
            Value::Stimulation => "stimulation",
            Value::Hedonism => "hedonism",
            Value::Achievement => "achievement",
            Value::Power => "power",
            Value::Security => "security",
            Value::Conformity => "conformity",
            Value::Tradition => "tradition",
            Value::Benevolence => "benevolence",
            Value::Universalism => "universalism",
        }
    }
    pub fn from_name(s: &str) -> Option<Value> {
        Value::ALL.into_iter().find(|v| v.name() == s)
    }
    pub fn index(self) -> usize {
        self as usize
    }
}

/// The needs a life meets or not (mind.ts `NEEDS`), in TS's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Need {
    Subsistence,
    Shelter,
    Security,
    Social,
    Status,
    Belonging,
    Meaning,
}

impl Need {
    pub const ALL: [Need; 7] = [Need::Subsistence, Need::Shelter, Need::Security, Need::Social, Need::Status, Need::Belonging, Need::Meaning];
    pub fn name(self) -> &'static str {
        match self {
            Need::Subsistence => "subsistence",
            Need::Shelter => "shelter",
            Need::Security => "security",
            Need::Social => "social",
            Need::Status => "status",
            Need::Belonging => "belonging",
            Need::Meaning => "meaning",
        }
    }
    pub fn from_name(s: &str) -> Option<Need> {
        Need::ALL.into_iter().find(|v| v.name() == s)
    }
    pub fn index(self) -> usize {
        self as usize
    }
}

/// The emotions a person feels about someone or something (mind.ts `Emotion`), with their half-lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Emotion {
    Joy,
    Distress,
    Hope,
    Fear,
    Anger,
    Gratitude,
}

impl Emotion {
    pub const ALL: [Emotion; 6] = [Emotion::Joy, Emotion::Distress, Emotion::Hope, Emotion::Fear, Emotion::Anger, Emotion::Gratitude];
    pub fn name(self) -> &'static str {
        match self {
            Emotion::Joy => "joy",
            Emotion::Distress => "distress",
            Emotion::Hope => "hope",
            Emotion::Fear => "fear",
            Emotion::Anger => "anger",
            Emotion::Gratitude => "gratitude",
        }
    }
    pub fn from_name(s: &str) -> Option<Emotion> {
        Emotion::ALL.into_iter().find(|v| v.name() == s)
    }
    /// mind.ts `EMOTION_HALF_LIFE_DAYS`.
    pub fn half_life_days(self) -> i64 {
        match self {
            Emotion::Joy => 7,
            Emotion::Distress => 14,
            Emotion::Hope => 14,
            Emotion::Fear => 30,
            Emotion::Anger => 60,
            Emotion::Gratitude => 90,
        }
    }
}

/// A figure for each value (basis points), indexed by `Value::index`.
pub type Values = [i64; 10];
/// A figure for each need (basis points), indexed by `Need::index`.
pub type Needs = [i64; 7];

// ---------------------------------------------------------------- fixed point

/// Millionths of a basis point: the scale of a figure TS kept as a float (an attraction; inner.rs's trust, agency,
/// dents and attachments).
pub const FINE: i64 = 1_000_000;

/// A fine figure, rounded to a whole basis point as `Math.round` would round the float.
pub fn whole(fine: i64) -> i64 {
    (fine + FINE / 2).div_euclid(FINE)
}

/// A float basis-point figure, kept fine.
pub fn fine(bps: f64) -> i64 {
    math::round(bps * FINE as f64)
}

/// A fine figure, as a float in basis points (for one computation).
pub fn as_bps(fine: i64) -> f64 {
    fine as f64 / FINE as f64
}

/// `a / b` rounded half up (b > 0), in integers.
fn ratio_round(a: i128, b: i128) -> i64 {
    (2 * a + b).div_euclid(2 * b) as i64
}

// ---------------------------------------------------------------- who a person is

/// One value's figures in a world (mean and spread, basis points).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dist {
    pub mean_bps: i64,
    pub sd_bps: i64,
}

/// Where a world gives no figure for a value.
pub const DIST_DEFAULT: Dist = Dist { mean_bps: 5_000, sd_bps: 1_500 };

/// A world's figures for drawing people: each value's importance, from its profile (keys are the values' names; a
/// key that is no value is ignored, as TS ignored it).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PopulationValues {
    #[serde(default)]
    pub values: BTreeMap<String, Dist>,
}

impl PopulationValues {
    /// A value's figures, or the default where the world gives none.
    pub fn of(&self, v: Value) -> Dist {
        self.values.get(v.name()).copied().unwrap_or(DIST_DEFAULT)
    }
}

/// How a person acts, apart from what they believe (Dwarf Fortress's facets beside its values).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Temperament {
    /// Trying what's new (stimulation, self-direction): exploration in learning (Rogers).
    pub openness: i64,
    /// Copying what most do (Boyd and Richerson's conformist bias).
    pub conformity: i64,
    /// Copying what the respected do (prestige bias).
    pub prestige: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Person {
    pub values: Values,
    pub temperament: Temperament,
    /// How much each need weighs, set by values (Dwarf Fortress: values set needs).
    pub weights: Needs,
}

/// A roughly normal draw (Irwin-Hall: the sum of 12 uniforms), in standard deviations, as a float for one computation.
pub fn normal_z(rng: &mut Rng) -> f64 {
    let mut s: i64 = 0;
    for _ in 0..12 {
        s += rng.below(1_000_001) as i64;
    }
    (s - 6_000_000) as f64 / 1_000_000.0
}

/// A roughly normal draw of this mean and spread (mind.ts `normal`).
pub fn normal(rng: &mut Rng, mean: f64, sd: f64) -> f64 {
    mean + normal_z(rng) * sd
}

/// A person, drawn from a world's figures. Temperament and need weights follow from values, by Schwartz's
/// motivational goals (our mapping, to test against data: docs/design/ai-citizens.md).
pub fn draw_person(rng: &mut Rng, pop: &PopulationValues) -> Person {
    person_of(draw_values(rng, pop))
}

/// A person's values, drawn from a world's figures, in `Value::ALL`'s order.
pub fn draw_values(rng: &mut Rng, pop: &PopulationValues) -> Values {
    let mut out = [0; 10];
    for v in Value::ALL {
        let d = pop.of(v);
        out[v.index()] = math::clamp_bps(normal(rng, d.mean_bps as f64, d.sd_bps as f64));
    }
    out
}

fn avg(xs: &[i64]) -> f64 {
    xs.iter().sum::<i64>() as f64 / xs.len() as f64
}

/// How much each need weighs for someone of these values: 1, plus up to 1 more as its values say. Belonging by
/// benevolence, conformity and tradition; meaning by tradition, universalism and benevolence (Saroglou, Delpierre and
/// Dernelle 2004, to confirm).
pub fn need_weights(values: &Values) -> Needs {
    let v = |x: Value| values[x.index()];
    let w = |x: f64| math::clamp(10_000.0 + x, 10_000, 20_000);
    use Value::*;
    [
        w(v(Hedonism) as f64 * 0.5),
        w(avg(&[v(Security), v(Tradition)]) * 0.5),
        w(v(Security) as f64),
        w(avg(&[v(Benevolence), v(Conformity)])),
        w(avg(&[v(Power), v(Achievement)])),
        w(avg(&[v(Benevolence), v(Conformity), v(Tradition)])),
        w(avg(&[v(Tradition), v(Universalism), v(Benevolence)])),
    ]
}

/// The person these values make: temperament and need weights follow from them.
pub fn person_of(values: Values) -> Person {
    let v = |x: Value| values[x.index()];
    use Value::*;
    let temperament = Temperament {
        openness: math::clamp_bps(avg(&[v(Stimulation), v(SelfDirection)])),
        conformity: math::clamp_bps(avg(&[v(Conformity), v(Tradition)])),
        prestige: math::clamp_bps(avg(&[v(Achievement), v(Power)])),
    };
    Person { values, temperament, weights: need_weights(&values) }
}

// ---------------------------------------------------------------- how satisfied

/// Overall satisfaction: needs met (0..10,000 each, as the citizen judges its own life), weighted as this person
/// weighs them (basis points).
pub fn satisfaction(p: &Person, levels: &Needs) -> i64 {
    let (mut num, mut den) = (0i64, 0i64);
    for n in Need::ALL {
        num += p.weights[n.index()] * levels[n.index()];
        den += p.weights[n.index()];
    }
    if den == 0 { 0 } else { math::round(num as f64 / den as f64) }
}

// ---------------------------------------------------------------- learning (EWA)

/// Experience-weighted attraction's parameters (Camerer and Ho 1999): phi (decay of past attraction), rho (decay of
/// experience), delta (weight on forgone payoffs), lambda (sensitivity). Placeholders near the paper's estimates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EwaParams {
    pub phi_bps: i64,
    pub rho_bps: i64,
    pub delta_bps: i64,
    /// Thousandths; written and read as TS's number `lambda`.
    #[serde(rename = "lambda", with = "milli")]
    pub lambda_milli: i64,
}

pub const EWA_DEFAULTS: EwaParams = EwaParams { phi_bps: 9000, rho_bps: 9000, delta_bps: 5000, lambda_milli: 4000 };

impl Default for EwaParams {
    fn default() -> Self {
        EWA_DEFAULTS
    }
}

/// A number in JSON, thousandths in Rust.
mod milli {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(x: &i64, s: S) -> Result<S::Ok, S::Error> {
        if x % 1000 == 0 {
            s.serialize_i64(x / 1000)
        } else {
            s.serialize_f64(*x as f64 / 1000.0)
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        let x = f64::deserialize(d)?;
        Ok(super::math::round(x * 1000.0))
    }
}

/// The experience weight's scale: billionths.
pub const N_SCALE: i64 = 1_000_000_000;

/// What a person has learned of the options in one area of life (EWA). Attractions in millionths of a basis point
/// (`FINE`), the experience weight in billionths (`N_SCALE`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attractions {
    a: BTreeMap<String, i64>,
    n: i64,
    e: EwaParams,
    /// What an option not yet tried is expected to give (basis points).
    prior: i64,
}

impl Default for Attractions {
    fn default() -> Self {
        Attractions::new(EWA_DEFAULTS, 0)
    }
}

impl Attractions {
    pub fn new(e: EwaParams, prior: i64) -> Self {
        Attractions { a: BTreeMap::new(), n: N_SCALE, e, prior }
    }

    /// The attraction, fine (millionths of a basis point).
    pub fn attraction(&self, option: &str) -> i64 {
        self.a.get(option).copied().unwrap_or(self.prior * FINE)
    }
    /// The attraction, rounded to a basis point.
    pub fn get(&self, option: &str) -> i64 {
        whole(self.attraction(option))
    }
    fn get_f(&self, option: &str) -> f64 {
        as_bps(self.attraction(option))
    }
    /// Tried at least once, or heard of with a payoff.
    pub fn known(&self, option: &str) -> bool {
        self.a.contains_key(option)
    }
    /// The experience weight, in billionths.
    pub fn experience(&self) -> i64 {
        self.n
    }

    /// After a choice: its payoff, and the forgone payoffs of the others where they're known.
    pub fn update(&mut self, chosen: &str, payoff: i64, forgone: &BTreeMap<String, i64>) {
        let phi = self.e.phi_bps as f64 / 10_000.0;
        let rho = self.e.rho_bps as f64 / 10_000.0;
        let delta = self.e.delta_bps as f64 / 10_000.0;
        let n0 = self.n as f64 / N_SCALE as f64;
        self.n = math::round((rho * n0 + 1.0) * N_SCALE as f64);
        let n = self.n as f64 / N_SCALE as f64;
        let mut all: BTreeSet<String> = self.a.keys().cloned().collect();
        all.insert(chosen.to_string());
        all.extend(forgone.keys().cloned());
        for o in all {
            let pay = if o == chosen { Some(payoff) } else { forgone.get(&o).copied() };
            let w = if o == chosen { 1.0 } else { delta };
            let prev = self.get_f(&o);
            let next = match pay {
                None => (phi * n0 * prev) / n,
                Some(p) => (phi * n0 * prev + w * p as f64) / n,
            };
            self.a.insert(o, fine(next));
        }
    }

    /// What someone else got from an option, as they told us: weighted as EWA weighs forgone payoffs (delta), against
    /// our own experience, applied when heard (our adaptation). The option is then known.
    pub fn hear(&mut self, option: &str, payoff: i64) {
        let delta = self.e.delta_bps as f64 / 10_000.0;
        let n = self.n as f64 / N_SCALE as f64;
        let prev = self.get_f(option);
        self.a.insert(option.to_string(), fine(prev + (delta / (n + delta)) * (payoff as f64 - prev)));
    }

    /// Choose among options (key, appraised value in basis points) by the logit of attraction plus value, with
    /// openness to explore. Returns the key and the integer weights drawn on (millionths).
    pub fn choose(&self, rng: &mut Rng, options: &[(String, i64)], openness_bps: i64) -> (String, Vec<i64>) {
        if options.is_empty() {
            return (String::new(), vec![]);
        }
        let lam = self.e.lambda_milli as f64 / 1000.0 * (1.0 - openness_bps as f64 / 20_000.0);
        let scores: Vec<f64> = options.iter().map(|(k, v)| (self.get_f(k) + *v as f64) / 10_000.0).collect();
        let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let weights: Vec<i64> = scores.iter().map(|s| math::round(math::exp(lam * (s - max)) * 1_000_000.0)).collect();
        let total: i64 = weights.iter().sum();
        let mut r = rng.below(total.max(1) as u64) as i64;
        for (i, w) in weights.iter().enumerate() {
            r -= w;
            if r < 0 {
                return (options[i].0.clone(), weights);
            }
        }
        (options[options.len() - 1].0.clone(), weights)
    }
}

// ---------------------------------------------------------------- how to decide (CONSUMAT)

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    Repeat,
    Imitate,
    Compare,
    Deliberate,
}

impl Strategy {
    pub fn name(self) -> &'static str {
        match self {
            Strategy::Repeat => "repeat",
            Strategy::Imitate => "imitate",
            Strategy::Compare => "compare",
            Strategy::Deliberate => "deliberate",
        }
    }
}

/// CONSUMAT (Jager 2000; Jager and Janssen 2012): satisfied and certain, repeat; satisfied and uncertain, imitate;
/// unsatisfied and certain, compare; unsatisfied and uncertain, deliberate. `aspiration_bps`: the satisfaction below
/// which a person looks to change; `certain_at_bps`: how well options must be known to count as certain.
pub fn strategy(satisfied_bps: i64, certainty_bps: i64, aspiration_bps: i64, certain_at_bps: i64) -> Strategy {
    let satisfied = satisfied_bps >= aspiration_bps;
    let certain = certainty_bps >= certain_at_bps;
    match (satisfied, certain) {
        (true, true) => Strategy::Repeat,
        (true, false) => Strategy::Imitate,
        (false, true) => Strategy::Compare,
        (false, false) => Strategy::Deliberate,
    }
}

// ---------------------------------------------------------------- appraising an offer's facts

/// What taking up an option would change, in a month, in the world's terms (from an offer's typed terms).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Facts {
    /// Money a month: + in, - out (cents).
    pub money_per_month: i64,
    /// A place to live comes with it (and its bedrooms, if known).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<HomeFacts>,
    /// Hours of work a month it asks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_hours_per_month: Option<i64>,
    /// Goods it brings, a month (units).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goods_per_month: Option<i64>,
    /// Others around: members, workmates, fellow attendees, where known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company: Option<i64>,
    /// Hours a month out of one's own time, unpaid (a meeting, a service, a class).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_hours_per_month: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeFacts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedrooms: Option<i64>,
}

/// A JavaScript truthy number: present and not 0.
fn truthy(x: Option<i64>) -> Option<i64> {
    x.filter(|&v| v != 0)
}

/// What giving up one's own time costs (basis points): a placeholder, about 40 an hour a month.
pub fn time_cost(f: &Facts) -> i64 {
    truthy(f.time_hours_per_month).map_or(0, |h| (h * 40).min(2_000))
}

/// What the facts do to each need (basis points of need, can be negative), indexed by `Need::index`; `None` where the
/// facts say nothing (belonging, meaning).
pub type Appraisal = [Option<i64>; 7];

/// What the facts do to each need, as this person weighs them. Response curves: money matters less the more one has
/// (a log), a home matters most without one, work costs time.
pub fn appraise(_p: &Person, f: &Facts, circ: &Circumstances) -> Appraisal {
    // A month's means, at least a month's essentials.
    let scale = 1i64.max(circ.essentials.unwrap_or(0)).max(circ.monthly_income + circ.savings.div_euclid(12));
    let money = f.money_per_month as f64 / scale as f64;
    let sign = if money > 0.0 { 1.0 } else if money < 0.0 { -1.0 } else { 0.0 };
    let money_value = sign * math::ln(1.0 + money.abs()) * 10_000.0;
    let spare = match (f.home.as_ref().and_then(|h| h.bedrooms), circ.home_bedrooms_needed) {
        (Some(b), Some(n)) => b - n,
        _ => 0,
    };
    let home = if f.home.is_some() {
        let base = if circ.homeless { 10_000 } else { 2_000 };
        (if spare < 0 { base / 2 } else { base }) + spare.clamp(0, 2) * 1_500
    } else {
        0
    };
    let work = truthy(f.work_hours_per_month);
    let work_cost = work.map_or(0, |h| (h * 15).min(3_000));
    let social = truthy(f.company).map_or(0, |c| math::round((math::ln(1.0 + c as f64) * 1_000.0).min(3_000.0)));
    let status = math::round(
        (if work.is_some() { 1_000.0 } else { 0.0 }) + money_value.max(0.0) * 0.3 - work_cost as f64 * 0.2,
    );
    let mut a: Appraisal = [None; 7];
    a[Need::Subsistence.index()] = Some(truthy(f.goods_per_month).map_or(0, |g| (g * 800).min(10_000)));
    a[Need::Shelter.index()] = Some(home);
    a[Need::Security.index()] = Some(math::round(money_value));
    a[Need::Social.index()] = Some(social);
    a[Need::Status.index()] = Some(status);
    a
}

/// One number: the appraisal weighted by this person's needs (basis points).
pub fn value(p: &Person, a: &Appraisal) -> i64 {
    let (mut num, mut den) = (0i64, 0i64);
    for n in Need::ALL {
        if let Some(x) = a[n.index()] {
            num += p.weights[n.index()] * x;
            den += p.weights[n.index()];
        }
    }
    if den == 0 { 0 } else { math::round(num as f64 / den as f64) }
}

/// A number TS read with `Number(x)` (a string or a number); what is no integer counts as 0 (TS's NaN; decided).
fn number(v: &serde_json::Value) -> i64 {
    match v {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or_else(|| n.as_f64().map_or(0, math::round)),
        serde_json::Value::String(s) => s.trim().parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

/// An offer's facts, from its typed terms (contracts: Offer): money a month in and out for the taker, a home, work
/// hours, goods. Terms in words count for nothing here. `units`: how many, where a commitment is per unit (TS's 1).
pub fn facts_of(offer: &serde_json::Value, units: i64) -> Facts {
    const MONTH: i128 = 30 * 86_400;
    let mut f = Facts::default();
    let Some(cs) = offer.pointer("/terms/commitments").and_then(|c| c.as_array()) else { return f };
    for c in cs {
        let Some(o) = c.pointer("/does/outcome").filter(|o| !o.is_null()) else { continue };
        let every = c.get("every").map(number).filter(|&e| e != 0);
        let per_unit = c.get("per").and_then(|p| p.as_str()) == Some("unit");
        let per_month = |x: i64| {
            let m = match every {
                Some(e) => ratio_round(x as i128 * MONTH, e as i128),
                None => x,
            };
            m * if per_unit { units } else { 1 }
        };
        let taker = c.get("who").and_then(|w| w.as_str()) == Some("taker");
        if let Some(m) = o.get("money").filter(|m| !m.is_null()) {
            let amount = m.get("amount").map(number).unwrap_or(0);
            f.money_per_month += (if taker { -1 } else { 1 }) * per_month(amount);
        }
        let occupancy = o.get("occupancy").is_some_and(|x| !x.is_null());
        if occupancy && !taker {
            f.home = Some(HomeFacts::default());
        }
        if occupancy && taker {
            f.work_hours_per_month = Some(f.work_hours_per_month.unwrap_or(0) + 160);
        }
        if let Some(w) = o.get("work").filter(|w| !w.is_null()) {
            if taker {
                let secs = per_month(w.get("hours").map(number).unwrap_or(0));
                f.work_hours_per_month = Some(f.work_hours_per_month.unwrap_or(0) + ratio_round(secs as i128, 3600));
            }
        }
        if let Some(g) = o.get("goods").filter(|g| !g.is_null()) {
            if !taker {
                let q = per_month(g.get("quantity").map(number).unwrap_or(0));
                f.goods_per_month = Some(f.goods_per_month.unwrap_or(0) + q);
            }
        }
    }
    f
}

// ---------------------------------------------------------------- a mind: the pieces together

/// A person's circumstances: income and savings (cents), whether homeless, the bedrooms their household needs, and
/// what a month's essentials cost in their world (the least a month's means is taken to be).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Circumstances {
    pub monthly_income: i64,
    pub savings: i64,
    pub homeless: bool,
    #[serde(rename = "homeBedroomsNeeded", default, skip_serializing_if = "Option::is_none")]
    pub home_bedrooms_needed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub essentials: Option<i64>,
}

/// An option in a decision: its key, its facts, how many others the person knows took it, and what it means to them
/// beyond the facts (basis points).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<Facts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub others: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meaning: Option<i64>,
}

/// The mind that decides, as decision records name it (contracts-0.7 A2: `state.mind`).
pub const MIND_VERSION: &str = "mind-0.3.0";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Score {
    pub key: String,
    pub score: i64,
}

/// A decision: what was chosen (none where nothing was offered), how, the scores, and the satisfaction and certainty
/// it was made at (basis points).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub strategy: Strategy,
    pub scores: Vec<Score>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub satisfaction: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certainty: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MindParams {
    /// Satisfaction below which a person looks to change (CONSUMAT's aspiration; placeholder).
    pub aspiration_bps: i64,
    /// How well options must be known to count as certain (share tried or heard of; placeholder).
    pub certainty_bps: i64,
    pub ewa: EwaParams,
}

pub const MIND_DEFAULTS: MindParams = MindParams { aspiration_bps: 6_000, certainty_bps: 5_000, ewa: EWA_DEFAULTS };

impl Default for MindParams {
    fn default() -> Self {
        MIND_DEFAULTS
    }
}

/// Parameters as a world gives them over the defaults (citizen.ts: `{ ...MIND_DEFAULTS, ...p.mind, ewa: {...} }`).
/// Keys of the wrong type: the defaults (decided: TS did not check).
pub fn mind_params(given: &serde_json::Value) -> MindParams {
    let mut d = serde_json::to_value(MIND_DEFAULTS).unwrap_or_default();
    if let (Some(dm), Some(gm)) = (d.as_object_mut(), given.as_object()) {
        for (k, v) in gm {
            match (k.as_str(), dm.get_mut(k)) {
                ("ewa", Some(serde_json::Value::Object(de))) => {
                    if let Some(ge) = v.as_object() {
                        for (ek, ev) in ge {
                            de.insert(ek.clone(), ev.clone());
                        }
                    }
                }
                _ => {
                    dm.insert(k.clone(), v.clone());
                }
            }
        }
    }
    serde_json::from_value(d).unwrap_or(MIND_DEFAULTS)
}

/// What `Mind::decide` is asked: the options the world offers, the current one, how needs stand, circumstances, how
/// this area has gone (basis points), and how much a feeling (fear) takes from certainty.
#[derive(Debug, Clone, Default)]
pub struct Ask {
    pub options: Vec<Choice>,
    pub current: Option<String>,
    pub levels: Needs,
    pub circ: Circumstances,
    pub satisfied_here: Option<i64>,
    pub doubt: Option<i64>,
}

/// A citizen's mind: a person drawn once, and what they've learned in each area of life (a domain: "shop", "job"...).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mind {
    pub person: Person,
    pub p: MindParams,
    /// What a person expects of an option not yet tried, by area (EWA's initial attractions).
    expect: BTreeMap<String, i64>,
    domains: BTreeMap<String, Attractions>,
}

impl Mind {
    /// `own`: the person's values where the world gave them (clamped); none: drawn here (and only then is `rng` drawn on).
    pub fn new(rng: &mut Rng, pop: &PopulationValues, p: MindParams, expect: BTreeMap<String, i64>, own: Option<Values>) -> Mind {
        let person = match own {
            Some(v) => person_of(v.map(|x| x.clamp(0, 10_000))),
            None => draw_person(rng, pop),
        };
        Mind { person, p, expect, domains: BTreeMap::new() }
    }

    /// The person's values have moved (drift, a shock): what they weigh follows. Temperament does not move.
    pub fn reweigh(&mut self) {
        self.person.weights = need_weights(&self.person.values);
    }

    pub fn learned(&mut self, domain: &str) -> &mut Attractions {
        let (e, prior) = (self.p.ewa, self.expect.get(domain).copied().unwrap_or(0));
        self.domains.entry(domain.to_string()).or_insert_with(|| Attractions::new(e, prior))
    }

    pub fn learn(&mut self, domain: &str, chosen: &str, payoff_bps: i64, forgone: &BTreeMap<String, i64>) {
        self.learned(domain).update(chosen, payoff_bps, forgone);
    }

    /// What someone told us an option gave them (word of mouth).
    pub fn hear(&mut self, domain: &str, option: &str, payoff_bps: i64) {
        self.learned(domain).hear(option, payoff_bps);
    }

    /// The choice CONSUMAT says a person like this, this satisfied, this sure of their options, would make.
    pub fn decide(&mut self, domain: &str, rng: &mut Rng, o: &Ask) -> Decision {
        self.learned(domain);
        let learned = &self.domains[domain];
        let mut options = o.options.clone();
        options.sort_by(|a, b| a.key.as_bytes().cmp(b.key.as_bytes()));
        let known = options.iter().filter(|x| learned.known(&x.key)).count() as i128;
        let n = options.len() as i128;
        let share = if n > 0 { ratio_round(known * 10_000, n) } else { 10_000 };
        let certainty = (share - o.doubt.unwrap_or(0)).max(0);
        // Life as a whole and, where the caller knows it, how this area has gone: the lower counts.
        let sat = satisfaction(&self.person, &o.levels).min(o.satisfied_here.unwrap_or(10_000));
        let s = strategy(sat, certainty, self.p.aspiration_bps, self.p.certainty_bps);
        let mut d = self.decide_as(s, rng, &options, learned, o);
        d.satisfaction = Some(sat);
        d.certainty = Some(certainty);
        d
    }

    fn decide_as(&self, s: Strategy, rng: &mut Rng, options: &[Choice], learned: &Attractions, o: &Ask) -> Decision {
        let done = |key: Option<String>, strategy: Strategy, scores: Vec<Score>| Decision { key, strategy, scores, satisfaction: None, certainty: None };
        let scored = |value: &dyn Fn(&Choice) -> i64| -> Vec<Score> {
            options.iter().map(|x| Score { key: x.key.clone(), score: math::round(learned.get_f(&x.key) + value(x) as f64) }).collect()
        };
        if options.is_empty() {
            return done(None, s, vec![]);
        }
        if s == Strategy::Repeat {
            if let Some(c) = o.current.as_ref().filter(|c| options.iter().any(|x| &x.key == *c)) {
                return done(Some(c.clone()), s, vec![]);
            }
        }
        if s == Strategy::Imitate {
            // What others do: conformists weigh how many took it (Boyd and Richerson).
            let told: Vec<&Choice> = options.iter().filter(|x| x.others.unwrap_or(0) > 0).collect();
            if !told.is_empty() {
                let k = 1.0 + self.person.temperament.conformity as f64 / 10_000.0;
                let weights: Vec<i64> = told.iter().map(|x| math::round(math::pow(x.others.unwrap_or(0) as f64, k) * 1000.0)).collect();
                let total: i64 = weights.iter().sum();
                let mut r = rng.below(total.max(1) as u64) as i64;
                for (i, w) in weights.iter().enumerate() {
                    r -= w;
                    if r < 0 {
                        let scores = told.iter().zip(&weights).map(|(x, w)| Score { key: x.key.clone(), score: *w }).collect();
                        return done(Some(told[i].key.clone()), s, scores);
                    }
                }
            }
            // Nobody to copy: what we know from experience (below), not habit alone.
        }
        if s == Strategy::Compare || s == Strategy::Imitate {
            let familiar: Vec<(String, i64)> = options.iter().filter(|x| learned.known(&x.key)).map(|x| (x.key.clone(), 0)).collect();
            if !familiar.is_empty() {
                let (key, _) = learned.choose(rng, &familiar, self.person.temperament.openness);
                return done(Some(key), Strategy::Compare, scored(&|_| 0)); // (what was done, whatever the quadrant)
            }
        }
        // Deliberate: every option's facts appraised against needs, with what's been learned, chosen by logit.
        let appraised = |x: &Choice| -> i64 {
            x.facts.as_ref().map_or(0, |f| value(&self.person, &appraise(&self.person, f, &o.circ)) - time_cost(f)) + x.meaning.unwrap_or(0)
        };
        let opts: Vec<(String, i64)> = options.iter().map(|x| (x.key.clone(), appraised(x))).collect();
        let (key, _) = learned.choose(rng, &opts, self.person.temperament.openness);
        done(Some(key), Strategy::Deliberate, scored(&appraised))
    }
}

// ---------------------------------------------------------------- feelings (OCC, lite) and ties

/// Emotions by appraisal (Ortony, Clore and Collins 1988, as FAtiMA computes them), each about someone or something,
/// each fading by its half-life (`Emotion::half_life_days`, placeholders). Kept by TS's key `"emotion:about"`, whose
/// byte order `strongest` walks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Feelings {
    felt: BTreeMap<String, Felt>,
    /// Days, by `Emotion` (in `Emotion::ALL`'s order).
    half_life: [i64; 6],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Felt {
    bps: i64,
    t: i64,
}

/// The strongest feeling now: what it is, about whom, how strong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Strongest {
    pub kind: Emotion,
    pub about: String,
    pub bps: i64,
}

impl Default for Feelings {
    fn default() -> Self {
        Feelings::new(Emotion::ALL.map(Emotion::half_life_days))
    }
}

fn emotion_index(e: Emotion) -> usize {
    Emotion::ALL.iter().position(|x| *x == e).unwrap_or(0)
}

impl Feelings {
    pub fn new(half_life_days: [i64; 6]) -> Self {
        Feelings { felt: BTreeMap::new(), half_life: half_life_days }
    }

    fn key(e: Emotion, about: &str) -> String {
        format!("{}:{}", e.name(), about)
    }

    fn faded(&self, e: Emotion, f: &Felt, t: i64) -> i64 {
        let hl = (self.half_life[emotion_index(e)] * 86_400) as f64;
        math::round(f.bps as f64 * math::pow(0.5, (t - f.t) as f64 / hl))
    }

    /// How strongly it's felt now (basis points), faded since.
    pub fn level(&self, e: Emotion, about: &str, t: i64) -> i64 {
        self.felt.get(&Self::key(e, about)).map_or(0, |f| self.faded(e, f, t))
    }

    /// Felt at least this strongly now (a stronger feeling isn't lessened by a milder cause).
    pub fn feel(&mut self, e: Emotion, about: &str, bps: i64, t: i64) {
        let bps = self.level(e, about, t).max(bps).min(10_000);
        self.felt.insert(Self::key(e, about), Felt { bps, t });
    }

    /// The strongest feeling now, if any (of equals, the first by key).
    pub fn strongest(&self, t: i64) -> Option<Strongest> {
        let mut best: Option<Strongest> = None;
        for (k, f) in &self.felt {
            let Some((kind, about)) = k.split_once(':') else { continue };
            let Some(e) = Emotion::from_name(kind) else { continue };
            let bps = self.faded(e, f, t);
            if bps > 0 && best.as_ref().is_none_or(|b| bps > b.bps) {
                best = Some(Strongest { kind: e, about: about.to_string(), bps });
            }
        }
        best
    }

    /// Felt more: a share of the way to its strongest.
    pub fn add(&mut self, e: Emotion, about: &str, bps: i64, t: i64) {
        let now = self.level(e, about, t);
        let more = math::round(((10_000 - now) * bps.min(10_000)) as f64 / 10_000.0);
        self.felt.insert(Self::key(e, about), Felt { bps: now + more, t });
    }
}

/// What last passed between two people, in a word, and when.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Last {
    pub what: String,
    pub t: i64,
}

/// A tie as read: affinity now (-10,000..10,000), trust, what last passed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tie {
    pub who: String,
    pub affinity: i64,
    pub trust: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<Last>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Kept {
    bps: i64,
    t: i64,
    trust: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last: Option<Last>,
}

/// Ties: affinity with each person known (Comme il Faut's and the Ensemble engine's social networks, lite), how far
/// they are trusted, what last passed. Fades toward none without contact (a placeholder half-life). Bounded (`kept`:
/// the sympathy group of about 15, Hill and Dunbar 2003), the faintest giving way.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ties {
    aff: BTreeMap<String, Kept>,
    half_life_days: i64,
    kept: usize,
    start_trust: i64,
}

impl Default for Ties {
    fn default() -> Self {
        Ties::new(180, 15, 5_000)
    }
}

impl Ties {
    pub fn new(half_life_days: i64, kept: usize, start_trust: i64) -> Self {
        Ties { aff: BTreeMap::new(), half_life_days, kept, start_trust }
    }

    fn faded(&self, a: &Kept, t: i64) -> i64 {
        math::round(a.bps as f64 * math::pow(0.5, (t - a.t) as f64 / (self.half_life_days * 86_400) as f64))
    }

    pub fn affinity(&self, who: &str, t: i64) -> i64 {
        self.aff.get(who).map_or(0, |a| self.faded(a, t))
    }

    /// `what`: what passed between us, in a word, kept as the last thing that did.
    pub fn add(&mut self, who: &str, bps: i64, t: i64, what: Option<&str>) {
        let was = self.aff.get(who);
        let last = match what {
            Some(w) => Some(Last { what: w.to_string(), t }),
            None => was.and_then(|a| a.last.clone()),
        };
        let trust = was.map_or(self.start_trust, |a| a.trust);
        let bps = (self.affinity(who, t) + bps).clamp(-10_000, 10_000);
        self.aff.insert(who.to_string(), Kept { bps, t, trust, last });
        if self.aff.len() > self.kept {
            // The faintest goes (by how strongly felt now, either way; of equals, by name).
            let mut drop: Option<String> = None;
            let mut least = i64::MAX;
            for (k, a) in &self.aff {
                if k == who {
                    continue;
                }
                let x = self.faded(a, t).abs();
                if x < least {
                    least = x;
                    drop = Some(k.clone());
                }
            }
            if let Some(d) = drop {
                self.aff.remove(&d);
            }
        }
    }

    /// How far we trust them, if we keep them.
    pub fn trust(&self, who: &str) -> Option<i64> {
        self.aff.get(who).map(|a| a.trust)
    }
    /// They did as they said (a share of the way to complete trust), or did not (of the way to none).
    pub fn trusted(&mut self, who: &str, good: bool, bps: i64) {
        if let Some(a) = self.aff.get_mut(who) {
            let x = a.trust as f64;
            a.trust = math::round(if good { x + ((10_000.0 - x) * bps as f64) / 10_000.0 } else { x - (x * bps as f64) / 10_000.0 });
        }
    }
    /// No longer anyone to us (they died, or left for good).
    pub fn drop(&mut self, who: &str) {
        self.aff.remove(who);
    }

    fn all(&self, t: i64) -> Vec<Tie> {
        self.aff.iter().map(|(who, a)| Tie { who: who.clone(), affinity: self.faded(a, t), trust: a.trust, last: a.last.clone() }).collect()
    }
    /// The closest few (affinity above nothing), closest first (of equals, by id).
    pub fn closest(&self, n: usize, t: i64) -> Vec<Tie> {
        let mut v: Vec<Tie> = self.all(t).into_iter().filter(|x| x.affinity > 0).collect();
        v.sort_by(|a, b| b.affinity.cmp(&a.affinity).then_with(|| a.who.cmp(&b.who)));
        v.truncate(n);
        v
    }
    /// The few most resented (affinity below nothing), most first (of equals, by id).
    pub fn resented(&self, n: usize, t: i64) -> Vec<Tie> {
        let mut v: Vec<Tie> = self.all(t).into_iter().filter(|x| x.affinity < 0).collect();
        v.sort_by(|a, b| a.affinity.cmp(&b.affinity).then_with(|| a.who.cmp(&b.who)));
        v.truncate(n);
        v
    }
}

// ---------------------------------------------------------------- goals with steps (HTN, lite)

/// A goal pursued by methods tried in turn: hierarchical task networks, one level deep. Each method is given time to
/// work; the goal is met when the need behind it recovers, and given up when no method is left.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pursuit {
    pub goal: String,
    pub methods: Vec<String>,
    pub since: i64,
    pub step: usize,
}

impl Pursuit {
    pub fn new(goal: &str, methods: Vec<String>, since: i64) -> Self {
        Pursuit { goal: goal.to_string(), methods, since, step: 0 }
    }
    pub fn method(&self) -> Option<&str> {
        self.methods.get(self.step).map(|s| s.as_str())
    }
    /// The next method (from now), if there's one left.
    pub fn next(&mut self, t: i64) -> Option<&str> {
        self.step += 1;
        self.since = t;
        self.method()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_core::rng::Randomness;

    const DAY: i64 = 86_400;
    fn rng(k: &str) -> Rng {
        Randomness::new(7).stream(&[k])
    }
    fn pop() -> PopulationValues {
        let mut values = BTreeMap::new();
        values.insert("security".into(), Dist { mean_bps: 7000, sd_bps: 1000 });
        values.insert("stimulation".into(), Dist { mean_bps: 3000, sd_bps: 1000 });
        PopulationValues { values }
    }
    fn no() -> BTreeMap<String, i64> {
        BTreeMap::new()
    }

    #[test]
    fn a_person_is_drawn_deterministically_and_values_set_temperament_and_weights() {
        let pop = pop();
        let a = draw_person(&mut rng("p1"), &pop);
        assert_eq!(draw_person(&mut rng("p1"), &pop), a);
        assert_ne!(draw_person(&mut rng("p2"), &pop), a);
        assert!(a.values.iter().all(|&v| (0..=10_000).contains(&v)));
        let people: Vec<Person> = (0..400).map(|i| draw_person(&mut rng(&format!("p{i}")), &pop)).collect();
        let mean = |f: &dyn Fn(&Person) -> i64| people.iter().map(f).sum::<i64>() as f64 / people.len() as f64;
        assert!((mean(&|p| p.values[Value::Security.index()]) - 7000.0).abs() < 250.0);
        assert!(mean(&|p| p.weights[Need::Security.index()]) > mean(&|p| p.weights[Need::Subsistence.index()]));
        assert!(mean(&|p| p.temperament.openness) < 5000.0);
    }

    #[test]
    fn consumat_quadrants_and_satisfaction() {
        assert_eq!(strategy(8000, 8000, 6000, 5000), Strategy::Repeat);
        assert_eq!(strategy(8000, 2000, 6000, 5000), Strategy::Imitate);
        assert_eq!(strategy(3000, 8000, 6000, 5000), Strategy::Compare);
        assert_eq!(strategy(3000, 2000, 6000, 5000), Strategy::Deliberate);
        let p = draw_person(&mut rng("s"), &pop());
        let full = [10_000; 7];
        assert_eq!(satisfaction(&p, &full), 10_000);
        let mut less = full;
        less[Need::Security.index()] = 0;
        assert!(satisfaction(&p, &less) < 10_000);
    }

    #[test]
    fn ewa_an_option_that_pays_is_chosen_more_and_the_open_explore() {
        let mut e = Attractions::default();
        let bad: BTreeMap<String, i64> = [("bad".to_string(), -1_000)].into();
        for _ in 0..10 {
            e.update("good", 3_000, &bad);
        }
        assert!(e.get("good") > e.get("bad"));
        assert!(e.known("good") && e.known("bad"));
        let opts = vec![("good".to_string(), 0), ("bad".to_string(), 0)];
        let pick = |open: i64| (0..2000).filter(|i| e.choose(&mut rng(&format!("c{i}")), &opts, open).0 == "good").count();
        let (closed, open) = (pick(0), pick(10_000));
        assert!(closed > 1000);
        assert!(open < closed);
        let (_, w) = e.choose(&mut rng("w"), &opts, 0);
        assert_eq!(w[0], 1_000_000); // (the best's weight is a million; the rest below)
        let before = e.attraction("good");
        e.update("bad", 0, &no());
        assert!(e.attraction("good") < before);
    }

    #[test]
    fn facts_of_typed_terms() {
        let job = serde_json::json!({ "terms": { "commitments": [
            { "who": "shop-3", "does": { "outcome": { "money": { "from": "acc-shop-3", "amount": "211356" } } }, "every": 1_209_600 },
            { "who": "taker", "does": { "outcome": { "occupancy": { "in": "shop-3-premises/workplace.1" } } } },
        ] } });
        // Math.round(211356 * 2592000 / 1209600) = Math.round(452905.714...) = 452906.
        assert_eq!(facts_of(&job, 1), Facts { money_per_month: 452_906, work_hours_per_month: Some(160), ..Default::default() });
        let lease = serde_json::json!({ "terms": { "commitments": [
            { "who": "landlord-1", "does": { "outcome": { "occupancy": { "in": "apts-1/dwelling.1" } } } },
            { "who": "taker", "does": { "outcome": { "money": { "to": "acc-landlord-1", "amount": "180000" } } }, "every": 2_592_000 },
        ] } });
        assert_eq!(facts_of(&lease, 1), Facts { money_per_month: -180_000, home: Some(HomeFacts::default()), ..Default::default() });
        let goods = serde_json::json!({ "terms": { "commitments": [
            { "who": "taker", "does": { "outcome": { "money": { "to": "acc-shop-1", "amount": "13000" } } }, "per": "unit" },
            { "who": "shop-1", "does": { "outcome": { "goods": { "kind": "goods", "quantity": "1" } } }, "per": "unit" },
        ] } });
        assert_eq!(facts_of(&goods, 5), Facts { money_per_month: -65_000, goods_per_month: Some(5), ..Default::default() });
        let words = serde_json::json!({ "terms": { "commitments": [{ "who": "church", "does": { "text": "Counts the taker among its members." } }] } });
        assert_eq!(facts_of(&words, 1), Facts::default());
    }

    #[test]
    fn appraising_a_home_matters_most_to_the_homeless_and_money_less_to_the_rich() {
        let p = draw_person(&mut rng("a"), &pop());
        let lease = Facts { money_per_month: -150_000, home: Some(HomeFacts::default()), ..Default::default() };
        let circ = |income: i64, homeless: bool| Circumstances { monthly_income: income, savings: 0, homeless, ..Default::default() };
        assert!(value(&p, &appraise(&p, &lease, &circ(500_000, true))) > value(&p, &appraise(&p, &lease, &circ(500_000, false))));
        let raise = Facts { money_per_month: 50_000, ..Default::default() };
        let s = Need::Security.index();
        assert!(appraise(&p, &raise, &circ(200_000, false))[s] > appraise(&p, &raise, &circ(2_000_000, false))[s]);
    }

    #[test]
    fn word_of_mouth_moves_less_than_ones_own_experience() {
        let mut heard = Attractions::new(EWA_DEFAULTS, 5_000);
        heard.hear("shop-a", 1_000);
        assert!(heard.known("shop-a"));
        assert!(heard.get("shop-a") < 5_000);
        let mut tried = Attractions::new(EWA_DEFAULTS, 5_000);
        tried.update("shop-a", 1_000, &no());
        assert!(tried.get("shop-a") < heard.get("shop-a"));
        let mut seasoned = Attractions::new(EWA_DEFAULTS, 5_000);
        for _ in 0..10 {
            seasoned.update("shop-a", 9_000, &no());
        }
        let before = seasoned.attraction("shop-a");
        seasoned.hear("shop-a", 1_000);
        assert!(before - seasoned.attraction("shop-a") < 5_000 * FINE - heard.attraction("shop-a"));
    }

    #[test]
    fn feelings_fade_a_milder_cause_does_not_lessen_and_ties_fade() {
        let mut f = Feelings::default();
        f.feel(Emotion::Anger, "landlord-1", 6_000, 0);
        assert_eq!(f.level(Emotion::Anger, "landlord-1", 0), 6_000);
        assert_eq!(f.level(Emotion::Anger, "landlord-1", 60 * DAY), 3_000);
        f.feel(Emotion::Anger, "landlord-1", 1_000, 60 * DAY);
        assert_eq!(f.level(Emotion::Anger, "landlord-1", 60 * DAY), 3_000);
        f.add(Emotion::Anger, "landlord-1", 5_000, 60 * DAY);
        assert_eq!(f.level(Emotion::Anger, "landlord-1", 60 * DAY), 6_500);
        assert_eq!(f.level(Emotion::Gratitude, "landlord-1", 0), 0);
        f.feel(Emotion::Fear, "money", 7_000, 60 * DAY);
        assert_eq!(f.strongest(60 * DAY), Some(Strongest { kind: Emotion::Fear, about: "money".into(), bps: 7_000 }));
        let mut t = Ties::default();
        t.add("c1", 2_000, 0, None);
        t.add("c1", 300, 0, None);
        assert_eq!(t.affinity("c1", 0), 2_300);
        assert_eq!(t.affinity("c1", 180 * DAY), 1_150);
        t.add("c2", -20_000, 0, None);
        assert_eq!(t.affinity("c2", 0), -10_000);
    }

    #[test]
    fn ties_are_bounded_keep_trust_and_what_passed() {
        let mut ties = Ties::new(180, 15, 4_000);
        for i in 0..60 {
            ties.add(&format!("c{i}"), 100 + i * 10, 0, Some("met"));
        }
        ties.add("friend", 5_000, 0, Some("tip"));
        ties.add("landlord-3", -3_000, 0, Some("notice"));
        ties.add("boss", -1_000, 0, Some("let_go"));
        assert_eq!(ties.closest(100, 0).len() + ties.resented(100, 0).len(), 15);
        assert_eq!(ties.closest(5, 0)[0], Tie { who: "friend".into(), affinity: 5_000, trust: 4_000, last: Some(Last { what: "tip".into(), t: 0 }) });
        assert_eq!(ties.resented(3, 0).iter().map(|x| x.who.as_str()).collect::<Vec<_>>(), ["landlord-3", "boss"]);
        assert_eq!(ties.affinity("c0", 0), 0);
        ties.trusted("friend", true, 2_000);
        assert_eq!(ties.trust("friend"), Some(5_200));
        ties.trusted("friend", false, 5_000);
        assert_eq!(ties.trust("friend"), Some(2_600));
        ties.drop("friend");
        assert!(!ties.closest(5, 0).iter().any(|x| x.who == "friend"));
        assert_eq!(ties.affinity("landlord-3", 180 * DAY), -1_500);
    }

    #[test]
    fn a_goal_is_pursued_by_one_method_after_another() {
        let mut g = Pursuit::new("make ends meet", vec!["spend less".into(), "cheaper home".into()], 0);
        assert_eq!(g.method(), Some("spend less"));
        assert_eq!(g.next(90), Some("cheaper home"));
        assert_eq!(g.since, 90);
        assert_eq!(g.next(180), None);
    }

    fn ask(levels: i64, options: Vec<Choice>) -> Ask {
        Ask { options, levels: [levels; 7], circ: Circumstances { monthly_income: 300_000, ..Default::default() }, ..Default::default() }
    }

    #[test]
    fn deciding_follows_the_quadrant() {
        let expect: BTreeMap<String, i64> = [("shop".to_string(), 8_000)].into();
        let mut m = Mind::new(&mut rng("m"), &pop(), MIND_DEFAULTS, expect, None);
        let shops = || vec![Choice { key: "b".into(), ..Default::default() }, Choice { key: "a".into(), others: Some(3), ..Default::default() }];
        // Nothing known, unsatisfied: deliberate, scored by the expectation of the area.
        let d = m.decide("shop", &mut rng("d1"), &ask(0, shops()));
        assert_eq!(d.strategy, Strategy::Deliberate);
        assert_eq!(d.certainty, Some(0));
        assert_eq!(d.scores.iter().map(|s| (s.key.as_str(), s.score)).collect::<Vec<_>>(), [("a", 8_000), ("b", 8_000)]);
        // Satisfied, uncertain: imitate whoever others took.
        let d = m.decide("shop", &mut rng("d2"), &ask(10_000, shops()));
        assert_eq!((d.strategy, d.key.as_deref()), (Strategy::Imitate, Some("a")));
        // Both known, satisfied, current offered: repeat.
        m.learn("shop", "a", 5_000, &[("b".to_string(), 1_000)].into());
        let mut a = ask(10_000, shops());
        a.current = Some("b".into());
        let d = m.decide("shop", &mut rng("d3"), &a);
        assert_eq!((d.strategy, d.key.as_deref(), d.certainty), (Strategy::Repeat, Some("b"), Some(10_000)));
        // Known, unsatisfied: compare; and a feeling's doubt makes it deliberate.
        assert_eq!(m.decide("shop", &mut rng("d4"), &ask(0, shops())).strategy, Strategy::Compare);
        let mut a = ask(0, shops());
        a.doubt = Some(6_000);
        assert_eq!(m.decide("shop", &mut rng("d5"), &a).strategy, Strategy::Deliberate);
        // Given values are the person's, clamped, and draw nothing.
        let own = Mind::new(&mut rng("x"), &pop(), MIND_DEFAULTS, no(), Some([12_000; 10]));
        assert_eq!(own.person.values, [10_000; 10]);
    }

    #[test]
    fn a_saved_mind_feelings_and_ties_behave_the_same_after() {
        let mut m = Mind::new(&mut rng("save"), &pop(), MIND_DEFAULTS, [("job".to_string(), 5_000)].into(), None);
        for i in 0..7 {
            m.learn("job", &format!("j{}", i % 3), 1_000 * i, &[("j9".to_string(), 333)].into());
            m.hear("job", "j4", 7_777);
        }
        let mut back: Mind = serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(back, m);
        let opts: Vec<Choice> = (0..6).map(|i| Choice { key: format!("j{i}"), facts: Some(Facts { money_per_month: 10_000 * i, ..Default::default() }), ..Default::default() }).collect();
        for k in 0..20 {
            let a = ask(k * 500, opts.clone());
            assert_eq!(m.decide("job", &mut rng(&format!("s{k}")), &a), back.decide("job", &mut rng(&format!("s{k}")), &a));
            m.learn("job", "j1", 4_321, &no());
            back.learn("job", "j1", 4_321, &no());
        }
        assert_eq!(back, m);
        let mut f = Feelings::default();
        f.feel(Emotion::Hope, "x", 4_000, 10);
        let mut t = Ties::default();
        t.add("a", 700, 5, Some("met"));
        let (mut f2, mut t2): (Feelings, Ties) = (serde_json::from_value(serde_json::to_value(&f).unwrap()).unwrap(), serde_json::from_value(serde_json::to_value(&t).unwrap()).unwrap());
        f.add(Emotion::Hope, "x", 3_000, 9 * DAY);
        f2.add(Emotion::Hope, "x", 3_000, 9 * DAY);
        t.add("a", 100, 40 * DAY, None);
        t2.add("a", 100, 40 * DAY, None);
        assert_eq!((f, t), (f2, t2));
        // (Params read and write as TS's JSON.)
        let p = mind_params(&serde_json::json!({ "aspiration_bps": 5_000, "ewa": { "lambda": 2.5 } }));
        assert_eq!((p.aspiration_bps, p.certainty_bps, p.ewa.lambda_milli, p.ewa.phi_bps), (5_000, 5_000, 2_500, 9_000));
        assert_eq!(serde_json::to_value(EWA_DEFAULTS).unwrap()["lambda"], serde_json::json!(4));
    }
}
