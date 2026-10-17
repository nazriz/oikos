//! participants/src/behaviour/inner.ts, in Rust (lane A2): the richer record of who a person is and how things stand
//! with them (docs/design/ai-citizens.md 10c, 10d; docs/behaviour/citizen.md "The record"): trust in particular
//! institutions, a sense of agency, attachments, a private and an expressed view of whoever holds power over them,
//! dents to belonging and meaning, values that drift and are shocked, a bounded memory, and where the hours go.
//! Arithmetic only: no draw but from the streams handed in. Every size is a parameter (`inner`); unless the doc's
//! table names a source, a PLACEHOLDER.
//!
//! Decided fresh in the port:
//! - **The values are passed, not shared.** TS's `Inner` held the mind's own values object and changed it in place;
//!   here each method that reads or moves values takes them (`&Values` / `&mut Values`: the mind's `person.values`),
//!   and the world's figures (`PopulationValues`) and `Outlook` are kept as copies.
//! - **Fixed point.** Trust in an institution, agency, the dents and attachments were floats in TS; here they are kept
//!   in millionths of a basis point (`person::FINE`), each step computed in f64 from the stored integers and rounded
//!   back, so they are TS's to well under a millionth of a basis point, and every figure TS rounded on the way out is
//!   rounded the same (`Math.round`, half up). The personal lean is kept in millionths of a standard deviation (the
//!   twelve integer draws summed, exactly).
//! - **Shares of one** in TS's arguments are basis points here: `weight` and `scale` (10,000 = 1; TS's 1 is the
//!   default, and a scale of exactly 10,000 counts as none, as TS's 1 did), and `closeness` (TS 0..1).
//! - **Readers return integers**: `z_of`, `z_agency`, `z_trust` in hundredths of a standard deviation, rounded half
//!   away from zero (the seam's convention: citizen/mind.rs); `integrity` in basis points. The arithmetic inside uses
//!   the unrounded figures, as TS did.
//! - **Orders.** Views keep TS's Map insertion order (a `Vec`, the oldest given way to first, a view written again moves
//!   to the end); trust's bound sorts by last use then id, as TS did, so a `BTreeMap` serves; hours sort by name.
//! - `inner_params` merges as TS's `innerParams`; a given value of the wrong type leaves the defaults (TS did not check).
//! - `start_attached` takes whole days (TS allowed a fraction).

use super::math;
use super::person::{as_bps, fine, normal_z, whole, PopulationValues, Value, Values, FINE};
use oikos_core::rng::Rng;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const DAY: i64 = 86_400;

/// A place's figures for how people start out (its profile's `outlook`): the share with confidence in each kind of
/// institution, the share who say most people can be trusted, how much control over their lives people feel.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outlook {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust: Option<BTreeMap<String, i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub people_bps: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agency: Option<Spread>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spread {
    pub mean_bps: i64,
    pub sd_bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustParams {
    /// Where trust in a kind of institution starts when the world gives no figure. PLACEHOLDER.
    pub start_bps: i64,
    /// How far people differ from their place's figure (one personal lean, a standard deviation). PLACEHOLDER.
    pub spread_bps: i64,
    /// How far a standard deviation of conservation over openness values raises trust in institutions (Devos, Spini
    /// and Schwartz 2002; size a PLACEHOLDER).
    pub values_bps: i64,
    /// A good experience moves trust this share of the way to complete. PLACEHOLDER.
    pub good_bps: i64,
    /// A bad one this share of the way to none (Slovic 1993's asymmetry; the ratio a PLACEHOLDER).
    pub bad_bps: i64,
    /// What someone else's experience, told to us, counts against our own (as EWA's delta).
    pub heard_bps: i64,
    /// Trust drifts back to where the person started, halving its distance in this long. PLACEHOLDER.
    pub return_half_life_days: i64,
    /// How many particular institutions a record keeps (the least used gives way).
    pub kept: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyParams {
    /// Where the world gives no figure: the mean and spread of how much control people feel. PLACEHOLDERS.
    pub mean_bps: i64,
    pub sd_bps: i64,
    /// Something tried that worked moves it this share up; one that failed, this share down. PLACEHOLDERS.
    pub worked_bps: i64,
    pub failed_bps: i64,
    /// Something done to the person they had no say in: losing work lowers perceived control by about 0.3 of a
    /// standard deviation (Preuss and Hennecke 2018).
    pub done_to_bps: i64,
    /// It returns to the person's own level, halving its distance in this long (the time a PLACEHOLDER).
    pub return_half_life_days: i64,
}

/// A dent's size by need (share of the need, at full closeness).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub belonging: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meaning: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NeedsParams {
    /// A dent to belonging or meaning heals, halving in this long. PLACEHOLDER.
    pub dent_half_life_days: i64,
    /// The dents, by what happened. PLACEHOLDERS.
    pub dents: BTreeMap<String, Dent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValuesParams {
    /// How alike a person's values are to their own after `stability_days` (a rank-order correlation): 0.48 to 0.69
    /// over 3.5 years in two German panels (docs/research/references.md); 0.6 taken. An upper bound on drift.
    pub stability_bps: i64,
    pub stability_days: i64,
    /// A shock's size, at full closeness (basis points of a value). PLACEHOLDER.
    pub shock_bps: i64,
    /// Which values a shock moves, and which way (+1 or -1), by value name (docs/behaviour/citizen.md). Bereavement:
    /// Sortheix et al. 2019, Verkasalo et al. 2006, Brown et al. 2004; a child: Lönnqvist, Leikas and Verkasalo 2018;
    /// ruin: Sortheix et al. 2019; eviction: by analogy with threat (PLACEHOLDER directions).
    pub shocks: BTreeMap<String, BTreeMap<String, i64>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewsParams {
    /// How much a person keeps to what they think whatever it costs, at the mean of their values. PLACEHOLDER.
    pub integrity_bps: i64,
    /// How far a standard deviation of self-direction and universalism over conformity and security raises it. PLACEHOLDER.
    pub integrity_values_bps: i64,
    /// How many power-holders a record keeps views of.
    pub kept: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachParams {
    /// Attachment grows toward complete, halving its distance in this long (length of residence the main predictor of
    /// place attachment: Lewicka 2011, to confirm; the times PLACEHOLDERS).
    pub place_half_life_days: i64,
    pub trade_half_life_days: i64,
    pub group_half_life_days: i64,
    /// And fades, once the tie is cut, halving in this long. PLACEHOLDER.
    pub fade_half_life_days: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryParams {
    pub recent: usize,
    pub defining: usize,
    /// An event at least this large is kept for good (the largest few).
    pub defining_bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InnerParams {
    pub trust: TrustParams,
    pub agency: AgencyParams,
    pub needs: NeedsParams,
    pub values: ValuesParams,
    pub views: ViewsParams,
    pub attach: AttachParams,
    pub memory: MemoryParams,
}

/// Events that are a kind of their own on the record and weigh as another kind does (docs/behaviour/justice.md,
/// "Left on an order").
fn like(what: &str) -> &str {
    match what {
        "left_on_order" => "evicted",
        w => w,
    }
}

/// inner.ts `INNER_DEFAULTS`.
pub fn inner_defaults() -> InnerParams {
    let dent = |b: Option<i64>, m: Option<i64>| Dent { belonging: b, meaning: m };
    let dirs = |xs: &[(&str, i64)]| xs.iter().map(|(k, v)| (k.to_string(), *v)).collect::<BTreeMap<_, _>>();
    InnerParams {
        trust: TrustParams { start_bps: 5_000, spread_bps: 1_500, values_bps: 500, good_bps: 300, bad_bps: 600, heard_bps: 5_000, return_half_life_days: 730, kept: 12 },
        agency: AgencyParams { mean_bps: 5_000, sd_bps: 2_000, worked_bps: 300, failed_bps: 300, done_to_bps: 600, return_half_life_days: 365 },
        needs: NeedsParams {
            dent_half_life_days: 180,
            dents: [
                ("bereaved", dent(Some(4_000), Some(5_000))),
                ("job_lost", dent(Some(1_000), Some(3_000))),
                ("evicted", dent(Some(3_000), Some(1_000))),
                ("ruined", dent(None, Some(2_000))),
                ("turned_away", dent(Some(1_000), None)),
            ]
            .into_iter()
            .map(|(k, d)| (k.to_string(), d))
            .collect(),
        },
        values: ValuesParams {
            stability_bps: 6_000,
            stability_days: 1_278,
            shock_bps: 400,
            shocks: [
                ("bereaved", dirs(&[("security", 1), ("tradition", 1), ("benevolence", 1), ("stimulation", -1), ("hedonism", -1)])),
                ("child", dirs(&[("security", 1), ("conformity", 1), ("tradition", 1), ("stimulation", -1), ("hedonism", -1)])),
                (
                    "ruined",
                    dirs(&[("security", 1), ("tradition", 1), ("conformity", 1), ("benevolence", 1), ("hedonism", -1), ("self_direction", -1), ("stimulation", -1)]),
                ),
                ("evicted", dirs(&[("security", 1), ("self_direction", -1)])),
            ]
            .into_iter()
            .map(|(k, d)| (k.to_string(), d))
            .collect(),
        },
        views: ViewsParams { integrity_bps: 5_000, integrity_values_bps: 1_500, kept: 4 },
        attach: AttachParams { place_half_life_days: 1_825, trade_half_life_days: 1_095, group_half_life_days: 365, fade_half_life_days: 365 },
        memory: MemoryParams { recent: 8, defining: 4, defining_bps: 5_000 },
    }
}

impl Default for InnerParams {
    fn default() -> Self {
        inner_defaults()
    }
}

/// How far the adults who raise a child count in the child's values (docs/behaviour/citizen.md, "Upbringing"), of
/// 10,000. PLACEHOLDER (a parent-child correlation of 0.2 to 0.3 is recalled, to confirm).
pub const UPBRINGING_SHARE_BPS: i64 = 5_000;

/// Parameters as a world gives them, over the defaults: each section merged key by key, and `needs.dents` and
/// `values.shocks` by what happened (as TS's `innerParams`).
pub fn inner_params(given: &serde_json::Value) -> InnerParams {
    let defaults = inner_defaults();
    let mut d = serde_json::to_value(&defaults).unwrap_or_default();
    if let (Some(dm), Some(gm)) = (d.as_object_mut(), given.as_object()) {
        for (sec, gv) in gm {
            let (Some(ds), Some(gs)) = (dm.get_mut(sec).and_then(|x| x.as_object_mut()), gv.as_object()) else { continue };
            for (k, v) in gs {
                let deep = matches!((sec.as_str(), k.as_str()), ("needs", "dents") | ("values", "shocks"));
                match (deep, ds.get_mut(k), v.as_object()) {
                    (true, Some(serde_json::Value::Object(inner)), Some(gi)) => {
                        for (ik, iv) in gi {
                            inner.insert(ik.clone(), iv.clone());
                        }
                    }
                    _ => {
                        ds.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }
    serde_json::from_value(d).unwrap_or(defaults)
}

/// A share of the way up to complete, or down to none (floats, for one computation).
fn up(x: f64, bps: f64) -> f64 {
    x + ((10_000.0 - x) * bps.clamp(0.0, 10_000.0)) / 10_000.0
}
fn down(x: f64, bps: f64) -> f64 {
    x - (x * bps.clamp(0.0, 10_000.0)) / 10_000.0
}
/// What is left of a distance after `dt` seconds at this half-life (TS's `left`: `0.5 ^ (dt / half)`, 1 for dt <= 0).
fn left(dt: i64, half_life_days: i64) -> f64 {
    if dt <= 0 {
        1.0
    } else {
        math::pow(0.5, dt as f64 / (half_life_days * DAY) as f64)
    }
}
/// Hundredths of a standard deviation, rounded half away from zero.
fn hundredths(z: f64) -> i64 {
    (z * 100.0).round() as i64
}

/// Something that happened, as the record remembers it: when, what (a word of the mind's own), about whom, how large.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Remembered {
    pub t: i64,
    pub what: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    pub size: i64,
    /// For what became of a want: the way taken.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

/// An attachment as the record shows it (whole basis points).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attachment {
    pub to: String,
    pub bps: i64,
    pub since: i64,
}

/// An attachment as kept: its strength fine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Attached {
    to: String,
    fine: i64,
    since: i64,
}

/// What a person can be attached to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Bond {
    Group,
    Place,
    Trade,
}

impl Bond {
    pub fn name(self) -> &'static str {
        match self {
            Bond::Group => "group",
            Bond::Place => "place",
            Bond::Trade => "trade",
        }
    }
}

/// A view of someone who holds power over the person: what they think (-10,000 against .. 10,000 for), what they say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct View {
    pub of: String,
    pub private: i64,
    pub expressed: i64,
}

/// What `view` weighs (basis points): how much they could cost us, how afraid we are, how far we trust them, and what
/// those around us say (none heard: saying nothing).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Pressure {
    pub dependence: i64,
    pub fear: i64,
    pub trust: i64,
    pub norm: Option<i64>,
}

/// A figure before and after a step, and as it would have stood without the words' scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Moved {
    pub before: i64,
    pub after: i64,
    pub plain: i64,
}

/// How an experience of an institution counts: `weight_bps` (10,000 = TS's 1, the default), heard of from someone
/// else, and the words' `scale_bps` (reading.ts; none or 10,000: unscaled).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Experienced {
    pub weight_bps: Option<i64>,
    pub heard: bool,
    pub scale_bps: Option<i64>,
}

/// What `happened` is told beyond the word: about whom, how close (basis points; none: 10,000), how large.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Happening {
    pub about: Option<String>,
    pub closeness_bps: Option<i64>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hours {
    pub from: i64,
    pub to: i64,
    pub seconds: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyNow {
    pub now: i64,
    pub own: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustRow {
    #[serde(rename = "in")]
    pub in_: String,
    pub kind: String,
    pub bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Memory {
    pub recent: Vec<Remembered>,
    pub defining: Vec<Remembered>,
}

/// The record's sections (inner.ts `sections()`), in TS's key order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sections {
    pub agency: AgencyNow,
    pub trust: Vec<TrustRow>,
    /// By bond name, in name order (group, place, trade).
    pub attached: BTreeMap<String, Attachment>,
    pub views: Vec<View>,
    pub memory: Memory,
}

/// A child's values from those who raise them (docs/behaviour/citizen.md, "Upbringing"): the mean of the adults'
/// values, pulled toward the town's by what is not passed on, and their own part, sized so the spread of values among
/// children is the town's. One normal draw per value, in `Value::ALL`'s order, whether or not there are adults.
pub fn raised_values(rng: &mut Rng, pop: &PopulationValues, adults: &[Values], share_bps: i64) -> Values {
    let a = share_bps.clamp(0, 10_000) as f64 / 10_000.0;
    let n = adults.len().max(1) as f64;
    let mut out = [0; 10];
    for v in Value::ALL {
        let d = pop.of(v);
        let own = normal_z(rng) * d.sd_bps as f64;
        let mean_bps = d.mean_bps as f64;
        out[v.index()] = if adults.is_empty() {
            math::clamp_bps(mean_bps + own)
        } else {
            let mean = adults.iter().map(|x| x[v.index()]).sum::<i64>() as f64 / n;
            math::clamp_bps(mean_bps + a * (mean - mean_bps) + math::sqrt((1.0 - (a * a) / n).max(0.0)) * own)
        };
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Trust {
    kind: String,
    fine: i64,
    base: i64,
    used: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Dented {
    fine: i64,
    t: i64,
}

/// The part of a person's inner life the deciding mind does not hold. One per citizen; the citizen tells it what
/// happened and reads from it what a record holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Inner {
    /// The person's own lean toward trusting institutions (millionths of a standard deviation).
    pub lean: i64,
    /// The person's own level of agency (basis points), where it returns to.
    pub agency_base: i64,
    agency: i64,
    trust: BTreeMap<String, Trust>,
    belonging: Dented,
    meaning: Dented,
    attached: BTreeMap<Bond, Attached>,
    /// In TS's Map order: the oldest first.
    views: Vec<View>,
    recent: Vec<Remembered>,
    defining: Vec<Remembered>,
    since: Vec<Remembered>,
    settled_at: i64,
    drifted_at: Option<i64>,
    drifts: i64,
    hours: BTreeMap<String, i64>,
    hours_from: i64,
    pop: PopulationValues,
    outlook: Outlook,
    pub p: InnerParams,
}

impl Inner {
    /// `values`: the person's (the mind's). `rng`: the person's stream for who they are (two normal draws: the lean,
    /// then agency).
    pub fn new(rng: &mut Rng, values: &Values, pop: &PopulationValues, outlook: &Outlook, p: InnerParams) -> Inner {
        let mut s: i64 = 0;
        for _ in 0..12 {
            s += rng.below(1_000_001) as i64;
        }
        let lean = s - 6_000_000;
        let mut me = Inner {
            lean,
            agency_base: 0,
            agency: 0,
            trust: BTreeMap::new(),
            belonging: Dented::default(),
            meaning: Dented::default(),
            attached: BTreeMap::new(),
            views: vec![],
            recent: vec![],
            defining: vec![],
            since: vec![],
            settled_at: 0,
            drifted_at: None,
            drifts: 0,
            hours: BTreeMap::new(),
            hours_from: 0,
            pop: pop.clone(),
            outlook: outlook.clone(),
            p,
        };
        let a = me.agency_spread();
        // (Those who value self-direction feel more in control: a tenth of the spread per standard deviation. PLACEHOLDER.)
        let z = normal_z(rng);
        me.agency_base = math::clamp_bps(a.mean_bps as f64 + a.sd_bps as f64 * (z + 0.1 * me.z(values, Value::SelfDirection)));
        me.agency = me.agency_base * FINE;
        me
    }

    fn agency_spread(&self) -> Spread {
        self.outlook.agency.unwrap_or(Spread { mean_bps: self.p.agency.mean_bps, sd_bps: self.p.agency.sd_bps })
    }

    fn z(&self, values: &Values, v: Value) -> f64 {
        let d = self.pop.of(v);
        ((values[v.index()] - d.mean_bps) as f64 / d.sd_bps.max(1) as f64).clamp(-3.0, 3.0)
    }
    fn lean_f(&self) -> f64 {
        self.lean as f64 / 1_000_000.0
    }

    /// How far a value sits from the town's mean (hundredths of a standard deviation, within 3).
    pub fn z_of(&self, values: &Values, v: Value) -> i64 {
        hundredths(self.z(values, v))
    }

    /// Agency now (basis points).
    pub fn agency(&self) -> i64 {
        whole(self.agency)
    }

    // ---------------------------------------------------------------- trust in particular institutions

    fn start_of(&self, kind: &str) -> i64 {
        self.outlook.trust.as_ref().and_then(|m| m.get(kind).copied()).unwrap_or(self.p.trust.start_bps)
    }

    fn entry(&mut self, values: &Values, who: &str, kind: &str, t: i64) -> &mut Trust {
        if !self.trust.contains_key(who) {
            let start = self.start_of(kind);
            let z = |v| self.z(values, v);
            let conserving = (z(Value::Conformity) + z(Value::Tradition) + z(Value::Security)) / 3.0 - (z(Value::SelfDirection) + z(Value::Stimulation)) / 2.0;
            let base = math::clamp_bps(start as f64 + self.p.trust.spread_bps as f64 * self.lean_f() + self.p.trust.values_bps as f64 * conserving);
            self.trust.insert(who.to_string(), Trust { kind: kind.to_string(), fine: base * FINE, base, used: t });
            // (Bounded: the one longest unused gives way; of equals, by id.)
            if self.trust.len() > self.p.trust.kept {
                let oldest = self.trust.iter().filter(|(k, _)| k.as_str() != who).min_by(|a, b| a.1.used.cmp(&b.1.used).then_with(|| a.0.cmp(b.0))).map(|(k, _)| k.clone());
                if let Some(k) = oldest {
                    self.trust.remove(&k);
                }
            }
        }
        let e = self.trust.get_mut(who).expect("just kept");
        e.used = e.used.max(t);
        e
    }

    /// How far we trust this institution now (it is known to us from here on).
    pub fn trust_in(&mut self, values: &Values, who: &str, kind: &str, t: i64) -> i64 {
        whole(self.entry(values, who, kind, t).fine)
    }
    /// As it stands, if it is one we keep.
    pub fn trusted(&self, who: &str) -> Option<i64> {
        self.trust.get(who).map(|e| whole(e.fine))
    }

    /// Something it did, to us or to someone who told us: well or badly.
    pub fn experience(&mut self, values: &Values, who: &str, kind: &str, good: bool, t: i64, o: Experienced) -> Moved {
        let (good_bps, bad_bps, heard_bps) = (self.p.trust.good_bps as f64, self.p.trust.bad_bps as f64, self.p.trust.heard_bps as f64);
        let e = self.entry(values, who, kind, t);
        let before = whole(e.fine);
        let w = o.weight_bps.unwrap_or(10_000) as f64 / 10_000.0 * if o.heard { heard_bps / 10_000.0 } else { 1.0 };
        let scale = o.scale_bps.filter(|&s| s != 10_000);
        let x = as_bps(e.fine);
        let moved = |x: f64, k: f64| if good { up(x, good_bps * w * k) } else { down(x, bad_bps * w * k) };
        let plain = scale.map(|_| math::round(moved(x, 1.0)));
        e.fine = fine(moved(x, scale.map_or(1.0, |s| s as f64 / 10_000.0)));
        let after = whole(e.fine);
        Moved { before, after, plain: plain.unwrap_or(after) }
    }

    // ---------------------------------------------------------------- agency

    /// Something we set out to do came off, or did not.
    pub fn tried(&mut self, worked: bool, weight_bps: i64, scale_bps: Option<i64>) -> Moved {
        let before = whole(self.agency);
        let x = as_bps(self.agency);
        let (wk, fl) = (self.p.agency.worked_bps as f64, self.p.agency.failed_bps as f64);
        let step = |w: f64| if worked { up(x, wk * w) } else { down(x, fl * w) };
        let weight = weight_bps as f64 / 10_000.0;
        let scale = scale_bps.filter(|&s| s != 10_000);
        let plain = scale.map(|_| math::round(step(weight)));
        self.agency = fine(step(weight * scale.map_or(1.0, |s| s as f64 / 10_000.0)));
        let after = whole(self.agency);
        Moved { before, after, plain: plain.unwrap_or(after) }
    }

    /// Something was done to us that we had no say in.
    pub fn done_to(&mut self, weight_bps: i64, scale_bps: Option<i64>) -> Moved {
        let before = whole(self.agency);
        let x = as_bps(self.agency);
        let off = self.p.agency.done_to_bps as f64 * weight_bps as f64 / 10_000.0;
        let scale = scale_bps.filter(|&s| s != 10_000);
        let plain = scale.map(|_| math::round((x - off).max(0.0)));
        self.agency = fine((x - off * scale.map_or(1.0, |s| s as f64 / 10_000.0)).max(0.0));
        let after = whole(self.agency);
        Moved { before, after, plain: plain.unwrap_or(after) }
    }

    // ---------------------------------------------------------------- belonging and meaning

    fn dented(&self, need: super::person::Need) -> Option<&Dented> {
        match need {
            super::person::Need::Belonging => Some(&self.belonging),
            super::person::Need::Meaning => Some(&self.meaning),
            _ => None,
        }
    }

    /// What is still felt of the dents to a need (belonging or meaning; any other: 0).
    pub fn dent(&self, need: super::person::Need, t: i64) -> i64 {
        self.dented(need).map_or(0, |d| math::round(as_bps(d.fine) * left(t - d.t, self.p.needs.dent_half_life_days)))
    }

    /// Someone told us they hold against something we did (culture, step 4): a dent to belonging, and remembered.
    pub fn disapproved(&mut self, bps: i64, t: i64, by: &str) {
        if bps <= 0 {
            return;
        }
        self.dent_by(super::person::Need::Belonging, bps as f64, t);
        self.remember(Remembered { t, what: "disapproved".into(), about: Some(by.to_string()), size: bps, by: None });
    }

    fn dent_by(&mut self, need: super::person::Need, bps: f64, t: i64) {
        let now = self.dent(need, t) as f64;
        let d = Dented { fine: fine((now + bps).min(10_000.0)), t };
        match need {
            super::person::Need::Belonging => self.belonging = d,
            super::person::Need::Meaning => self.meaning = d,
            _ => {}
        }
    }

    // ---------------------------------------------------------------- attachments

    fn half_of(&self, which: Bond) -> i64 {
        let a = &self.p.attach;
        match which {
            Bond::Place => a.place_half_life_days,
            Bond::Trade => a.trade_half_life_days,
            Bond::Group => a.group_half_life_days,
        }
    }

    /// A week (or however long, since the last `settle`) more with what we are attached to, or with something else in
    /// its place, or without.
    pub fn attach(&mut self, which: Bond, to: Option<&str>, t: i64) {
        let half = self.half_of(which);
        let fade = self.p.attach.fade_half_life_days;
        let dt = t - self.settled_at;
        match self.attached.get_mut(&which) {
            Some(a) if to != Some(a.to.as_str()) => {
                // Cut: it fades; a new one begins once the old has faded below what the new would start at.
                a.fine = fine(as_bps(a.fine) * left(dt, fade));
                match to {
                    Some(new) if a.fine < 500 * FINE => {
                        self.attached.insert(which, Attached { to: new.to_string(), fine: 0, since: t });
                    }
                    None if a.fine < 50 * FINE => {
                        self.attached.remove(&which);
                    }
                    _ => {}
                }
            }
            Some(a) => a.fine = fine(10_000.0 - (10_000.0 - as_bps(a.fine)) * left(dt, half)),
            None => {
                if let Some(new) = to {
                    self.attached.insert(which, Attached { to: new.to_string(), fine: 0, since: t });
                }
            }
        }
    }

    /// How strongly, now (0 if to nothing, or to something else).
    pub fn attached_to(&self, which: Bond, to: Option<&str>) -> i64 {
        match self.attached.get(&which) {
            Some(a) if to.is_none_or(|x| x == a.to) => whole(a.fine),
            _ => 0,
        }
    }

    /// Attached for this many days before the world began.
    pub fn start_attached(&mut self, which: Bond, to: &str, days: i64, t: i64) {
        let half = self.half_of(which);
        self.attached.insert(which, Attached { to: to.to_string(), fine: fine(10_000.0 * (1.0 - left(days * DAY, half))), since: t - days * DAY });
    }

    // ---------------------------------------------------------------- what is thought and what is said

    fn integrity_f(&self, values: &Values) -> f64 {
        let z = |v| self.z(values, v);
        let lean = (z(Value::SelfDirection) + z(Value::Universalism)) / 2.0 - (z(Value::Conformity) + z(Value::Security)) / 2.0;
        ((self.p.views.integrity_bps as f64 + self.p.views.integrity_values_bps as f64 * lean) / 10_000.0).clamp(0.0, 1.0)
    }

    /// How much our own mind holds out against what is expected (basis points; TS 0..1).
    pub fn integrity(&self, values: &Values) -> i64 {
        math::round(self.integrity_f(values) * 10_000.0)
    }

    /// Our view of someone who holds power over us (Kuran 1995): what we think, and what we say. What is said leans
    /// toward what those around us say by the pressure we are under (dependence times fear times distrust) less our
    /// own integrity.
    pub fn view(&mut self, values: &Values, of: &str, think: i64, o: Pressure) -> View {
        let pressure = (o.dependence as f64 / 10_000.0) * (o.fear as f64 / 10_000.0) * (1.0 - o.trust as f64 / 10_000.0);
        let integrity = self.integrity_f(values);
        let gap = (pressure * (1.0 - integrity) * 4.0).clamp(0.0, 1.0); // (the 4 a PLACEHOLDER scale)
        let private = think.clamp(-10_000, 10_000);
        let norm = o.norm.unwrap_or(0) as f64;
        let v = View { of: of.to_string(), private, expressed: math::clamp(private as f64 + gap * (norm - private as f64), -10_000, 10_000) };
        self.views.retain(|x| x.of != of);
        self.views.push(v.clone());
        while self.views.len() > self.p.views.kept {
            self.views.remove(0);
        }
        v
    }
    pub fn view_of(&self, of: &str) -> Option<&View> {
        self.views.iter().find(|v| v.of == of)
    }
    pub fn forget(&mut self, of: &str) {
        self.views.retain(|v| v.of != of);
    }

    // ---------------------------------------------------------------- values: drift and shocks

    /// Slow drift (docs/behaviour/citizen.md, "Values move"): each month every value takes an Ornstein-Uhlenbeck step
    /// toward the town's mean, sized so values after `stability_days` correlate with their own at `stability_bps` and
    /// the town's spread stays. Returns whether anything moved. `rng(purpose)`: the person's stream for that purpose
    /// (`values-drift-<n>`, n counting the months drifted). The first call only starts the count.
    pub fn drift(&mut self, values: &mut Values, rng: &mut dyn FnMut(&str) -> Rng, t: i64) -> bool {
        const MONTH: i64 = 30 * DAY;
        let Some(mut at) = self.drifted_at else {
            self.drifted_at = Some(t);
            return false;
        };
        let mut moved = false;
        while t - at >= MONTH {
            at += MONTH;
            self.drifts += 1;
            let mut r = rng(&format!("values-drift-{}", self.drifts));
            let keep = math::pow(self.p.values.stability_bps as f64 / 10_000.0, MONTH as f64 / (self.p.values.stability_days * DAY) as f64);
            for v in Value::ALL {
                let d = self.pop.of(v);
                let m = d.mean_bps as f64;
                values[v.index()] = math::clamp_bps(m + keep * (values[v.index()] as f64 - m) + math::sqrt(1.0 - keep * keep) * d.sd_bps as f64 * normal_z(&mut r));
            }
            moved = true;
        }
        self.drifted_at = Some(at);
        moved
    }

    /// A shock: the values it moves, each by the shock's size at this closeness (basis points), as the literature says.
    pub fn shock(&self, values: &mut Values, what: &str, closeness_bps: i64) {
        let Some(dirs) = self.p.values.shocks.get(what) else { return };
        let c = closeness_bps.clamp(0, 10_000) as f64 / 10_000.0;
        for v in Value::ALL {
            if let Some(&dir) = dirs.get(v.name()).filter(|&&d| d != 0) {
                values[v.index()] = math::clamp_bps(values[v.index()] as f64 + (dir * self.p.values.shock_bps) as f64 * c);
            }
        }
    }

    // ---------------------------------------------------------------- what happens

    /// Something happened to us or to someone we are tied to (closeness 10,000: our own or our household's): it is
    /// remembered, dents what it dents, and shocks what it shocks. `what` is a word the parameters know or any other,
    /// which is only remembered.
    pub fn happened(&mut self, values: &mut Values, what: &str, t: i64, o: Happening) {
        let cb = o.closeness_bps.unwrap_or(10_000).clamp(0, 10_000);
        let c = cb as f64 / 10_000.0;
        let kind = like(what).to_string();
        let dents = self.p.needs.dents.get(&kind).copied();
        if let Some(b) = dents.and_then(|d| d.belonging).filter(|&b| b != 0) {
            self.dent_by(super::person::Need::Belonging, b as f64 * c, t);
        }
        if let Some(m) = dents.and_then(|d| d.meaning).filter(|&m| m != 0) {
            self.dent_by(super::person::Need::Meaning, m as f64 * c, t);
        }
        self.shock(values, &kind, cb);
        // (TS: `o.size ?? max(...) * c`: a size given is taken as it is, not scaled by closeness.)
        let size = o.size.unwrap_or_else(|| {
            let b = dents.and_then(|d| d.belonging).unwrap_or(0);
            let m = dents.and_then(|d| d.meaning).unwrap_or(0);
            let s = if self.p.values.shocks.contains_key(&kind) { self.p.memory.defining_bps } else { 1_000 };
            math::round(b.max(m).max(s) as f64 * c)
        });
        self.remember(Remembered { t, what: what.to_string(), about: o.about, size, by: None });
    }

    /// Something for a change's `because` only (what became of a want): said once with the record's next change.
    pub fn note(&mut self, r: Remembered) {
        self.since.push(r);
        if self.since.len() > 16 {
            self.since.remove(0);
        }
    }

    /// How far the sense of agency sits from the town's mean (hundredths of a standard deviation, within 3).
    pub fn z_agency(&self) -> i64 {
        let a = self.agency_spread();
        hundredths(((as_bps(self.agency) - a.mean_bps as f64) / a.sd_bps.max(1) as f64).clamp(-3.0, 3.0))
    }
    /// How far trust in this institution sits from the town's figure for its kind (hundredths of a standard deviation
    /// of the personal lean, within 3).
    pub fn z_trust(&mut self, values: &Values, who: &str, kind: &str, t: i64) -> i64 {
        let start = self.start_of(kind) as f64;
        let spread = self.p.trust.spread_bps.max(1) as f64;
        let x = as_bps(self.entry(values, who, kind, t).fine);
        hundredths(((x - start) / spread).clamp(-3.0, 3.0))
    }

    /// `z_trust` read without keeping the entry (what it would be were it read now): for weighing several at once,
    /// whose entries the caller then keeps with `trust_in`, as TS's reads did.
    pub fn z_trust_peek(&self, values: &Values, who: &str, kind: &str) -> i64 {
        let start = self.start_of(kind) as f64;
        let spread = self.p.trust.spread_bps.max(1) as f64;
        let x = match self.trust.get(who) {
            Some(e) => as_bps(e.fine),
            None => {
                let z = |v| self.z(values, v);
                let conserving = (z(Value::Conformity) + z(Value::Tradition) + z(Value::Security)) / 3.0 - (z(Value::SelfDirection) + z(Value::Stimulation)) / 2.0;
                math::clamp_bps(start + self.p.trust.spread_bps as f64 * self.lean_f() + self.p.trust.values_bps as f64 * conserving) as f64
            }
        };
        hundredths(((x - start) / spread).clamp(-3.0, 3.0))
    }

    /// Kept: among the last few, and, if large, among the few that defined us (the largest, kept for good).
    pub fn remember(&mut self, r: Remembered) {
        self.since.push(r.clone());
        if self.since.len() > 16 {
            self.since.remove(0);
        }
        self.recent.push(r.clone());
        if self.recent.len() > self.p.memory.recent {
            self.recent.remove(0);
        }
        if r.size >= self.p.memory.defining_bps {
            self.defining.push(r);
            if self.defining.len() > self.p.memory.defining {
                // The smallest goes (of equals, the latest: the first to define us stays).
                let mut drop = 0;
                for i in 1..self.defining.len() {
                    if self.defining[i].size <= self.defining[drop].size {
                        drop = i;
                    }
                }
                self.defining.remove(drop);
            }
        }
    }

    // ---------------------------------------------------------------- time

    /// Time passing: trust and agency drift back to the person's own. Called at each plan.
    pub fn settle(&mut self, t: i64) {
        let dt = t - self.settled_at;
        if dt <= 0 {
            return;
        }
        let kt = left(dt, self.p.trust.return_half_life_days);
        for e in self.trust.values_mut() {
            let base = e.base * FINE;
            e.fine = base + math::round((e.fine - base) as f64 * kt);
        }
        let base = self.agency_base * FINE;
        self.agency = base + math::round((self.agency - base) as f64 * left(dt, self.p.agency.return_half_life_days));
        self.settled_at = t;
    }

    /// Seconds spent at something (work, learning, gathering, care, home, away).
    pub fn spent(&mut self, category: &str, seconds: i64) {
        if seconds > 0 {
            *self.hours.entry(category.to_string()).or_insert(0) += seconds;
        }
    }
    /// Someone whose first hour in the world is `t`: their hours are counted from there.
    pub fn hours_begin(&mut self, t: i64) {
        self.hours.clear();
        self.hours_from = t;
    }
    /// The hours since they were last taken, and from when; they start again from `t`.
    pub fn take_hours(&mut self, t: i64) -> Hours {
        let out = Hours { from: self.hours_from, to: t, seconds: std::mem::take(&mut self.hours) };
        self.hours_from = t;
        out
    }

    // ---------------------------------------------------------------- the record's sections

    /// What has happened since this was last asked: for a change's `because`.
    pub fn take_since(&mut self) -> Vec<Remembered> {
        std::mem::take(&mut self.since)
    }

    pub fn sections(&self) -> Sections {
        let mut views = self.views.clone();
        views.sort_by(|a, b| a.of.cmp(&b.of));
        Sections {
            agency: AgencyNow { now: whole(self.agency), own: self.agency_base },
            trust: self.trust.iter().map(|(who, e)| TrustRow { in_: who.clone(), kind: e.kind.clone(), bps: whole(e.fine) }).collect(),
            attached: self.attached.iter().map(|(k, a)| (k.name().to_string(), Attachment { to: a.to.clone(), bps: whole(a.fine), since: a.since })).collect(),
            views,
            memory: Memory { recent: self.recent.clone(), defining: self.defining.clone() },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::person::{draw_values, Dist, Need};
    use super::*;
    use oikos_core::rng::Randomness;

    fn rng(k: &str) -> Rng {
        Randomness::new(7).stream(&["test", k])
    }
    fn pop() -> PopulationValues {
        PopulationValues { values: Value::ALL.iter().enumerate().map(|(i, v)| (v.name().to_string(), Dist { mean_bps: 4_000 + 300 * i as i64, sd_bps: 1_500 })).collect() }
    }
    struct P {
        values: Values,
        inner: Inner,
    }
    fn person_with(k: &str, outlook: Outlook) -> P {
        let pop = pop();
        let values = draw_values(&mut rng(&format!("v-{k}")), &pop);
        let inner = Inner::new(&mut rng(&format!("i-{k}")), &values, &pop, &outlook, inner_params(&serde_json::json!({})));
        P { values, inner }
    }
    fn person(k: &str) -> P {
        person_with(k, Outlook::default())
    }
    fn trust(pairs: &[(&str, i64)]) -> Outlook {
        Outlook { trust: Some(pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()), ..Default::default() }
    }
    fn mean(xs: &[f64]) -> f64 {
        xs.iter().sum::<f64>() / xs.len() as f64
    }
    fn sd(xs: &[f64]) -> f64 {
        let m = mean(xs);
        mean(&xs.iter().map(|x| (x - m) * (x - m)).collect::<Vec<_>>()).sqrt()
    }
    fn corr(a: &[f64], b: &[f64]) -> f64 {
        let (ma, mb) = (mean(a), mean(b));
        mean(&a.iter().zip(b).map(|(x, y)| (x - ma) * (y - mb)).collect::<Vec<_>>()) / (sd(a) * sd(b))
    }
    const DAY: i64 = 86_400;
    fn d() -> InnerParams {
        inner_defaults()
    }
    fn none() -> Experienced {
        Experienced::default()
    }

    #[test]
    fn trust_starts_from_its_kind_is_lost_faster_than_won_counts_hearsay_less_and_drifts_back() {
        let mut starts: Vec<P> = (0..400).map(|i| person_with(&format!("t{i}"), trust(&[("banks", 3_000), ("policing", 8_000)]))).collect();
        let m = |s: &mut Vec<P>, who: &str, kind: &str| mean(&s.iter_mut().map(|p| p.inner.trust_in(&p.values, who, kind, 0) as f64).collect::<Vec<_>>());
        assert!((m(&mut starts, "bank", "banks") - 3_000.0).abs() < 250.0);
        assert!((m(&mut starts, "constabulary", "policing") - 8_000.0).abs() < 250.0);
        assert!((m(&mut starts, "landlord-1", "other") - d().trust.start_bps as f64).abs() < 250.0);
        let mut a = person_with("a", trust(&[("banks", 5_000)]));
        let base = a.inner.trust_in(&a.values, "bank", "banks", 0);
        let good = a.inner.experience(&a.values, "bank", "banks", true, 0, none());
        assert!(good.after > good.before);
        let mut b = person_with("a", trust(&[("banks", 5_000)]));
        let bad = b.inner.experience(&b.values, "bank", "banks", false, 0, none());
        assert!(bad.before - bad.after > good.after - good.before);
        let mut c = person_with("a", trust(&[("banks", 5_000)]));
        let heard = c.inner.experience(&c.values, "bank", "banks", false, 0, Experienced { heard: true, ..none() });
        assert!(heard.before - heard.after < bad.before - bad.after && heard.before > heard.after);
        b.inner.settle(d().trust.return_half_life_days * DAY);
        assert!((b.inner.trusted("bank").unwrap() - (base - (base - bad.after) / 2)).abs() <= 2);
        for i in 0..40 {
            a.inner.trust_in(&a.values, &format!("office-{i}"), "civil_service", i + 1);
        }
        assert_eq!(a.inner.sections().trust.len(), d().trust.kept);
        assert_eq!(a.inner.trusted("bank"), None);
        // A words' scale moves it further, and `plain` says where it would have stood.
        let mut s = person_with("a", trust(&[("banks", 5_000)]));
        let scaled = s.inner.experience(&s.values, "bank", "banks", false, 0, Experienced { scale_bps: Some(15_000), ..none() });
        assert_eq!(scaled.plain, bad.after);
        assert!(scaled.after < bad.after);
    }

    #[test]
    fn agency_rises_falls_and_returns() {
        let mut p = person("g");
        let own = p.inner.agency_base;
        p.inner.tried(true, 10_000, None);
        assert!(p.inner.agency() > own);
        p.inner.tried(false, 10_000, None);
        p.inner.tried(false, 10_000, None);
        assert!(p.inner.agency() < own);
        let before = p.inner.agency;
        p.inner.done_to(10_000, None);
        assert_eq!(whole(before - p.inner.agency), whole(before).min(d().agency.done_to_bps));
        p.inner.settle(d().agency.return_half_life_days * DAY * 20);
        assert!((p.inner.agency - own * FINE).abs() < FINE);
        assert_eq!(p.inner.sections().agency, AgencyNow { now: own, own });
    }

    #[test]
    fn what_is_said_leans_to_the_norm_under_fear_and_the_principled_give_less() {
        let mut p = person("v");
        let pr = |fear, trust, norm| Pressure { dependence: 8_000, fear, trust, norm };
        assert_eq!(p.inner.view(&p.values, "landlord", -6_000, pr(0, 2_000, Some(3_000))), View { of: "landlord".into(), private: -6_000, expressed: -6_000 });
        let afraid = p.inner.view(&p.values, "landlord", -6_000, pr(9_000, 2_000, Some(3_000)));
        assert_eq!(afraid.private, -6_000);
        assert!(afraid.expressed > -6_000 && afraid.expressed <= 3_000);
        assert_eq!(p.inner.view(&p.values, "landlord", -6_000, pr(9_000, 10_000, Some(3_000))).expressed, -6_000);
        let quiet = p.inner.view(&p.values, "boss", -6_000, pr(9_000, 2_000, None));
        assert!(quiet.expressed > -6_000 && quiet.expressed <= 0);
        let (mut ints, mut gaps) = (vec![], vec![]);
        for i in 0..300 {
            let mut q = person(&format!("p{i}"));
            let z = |v| q.inner.z(&q.values, v);
            ints.push((z(Value::SelfDirection) + z(Value::Universalism)) / 2.0 - (z(Value::Conformity) + z(Value::Security)) / 2.0);
            gaps.push((q.inner.view(&q.values, "x", -6_000, pr(9_000, 2_000, Some(3_000))).expressed + 6_000) as f64);
        }
        assert!(corr(&ints, &gaps) < -0.5);
        for i in 0..9 {
            p.inner.view(&p.values, &format!("who-{i}"), 0, Pressure::default());
        }
        let views = p.inner.sections().views;
        assert_eq!(views.len(), d().views.kept);
        assert_eq!(views.iter().map(|v| v.of.as_str()).collect::<Vec<_>>(), ["who-5", "who-6", "who-7", "who-8"]);
    }

    #[test]
    fn values_drift_slowly_as_the_source_says_and_the_spread_stays() {
        let pd = d().values;
        let mut people: Vec<P> = (0..600).map(|i| person(&format!("d{i}"))).collect();
        let before: Vec<Values> = people.iter().map(|p| p.values).collect();
        for (i, p) in people.iter_mut().enumerate() {
            let mut s = |k: &str| rng(&format!("drift-{i}-{k}"));
            assert!(!p.inner.drift(&mut p.values, &mut s, 0));
            assert!(p.inner.drift(&mut p.values, &mut s, pd.stability_days * DAY));
        }
        for v in [Value::Security, Value::Stimulation, Value::Benevolence] {
            let a: Vec<f64> = before.iter().map(|x| x[v.index()] as f64).collect();
            let b: Vec<f64> = people.iter().map(|p| p.values[v.index()] as f64).collect();
            assert!((corr(&a, &b) - pd.stability_bps as f64 / 10_000.0).abs() < 0.08);
            assert!((sd(&b) - sd(&a)).abs() < 150.0);
            assert!((mean(&b) - mean(&a)).abs() < 150.0);
        }
        for (i, was) in people.iter().take(5).enumerate() {
            let mut p = person(&format!("d{i}"));
            let mut s = |k: &str| rng(&format!("drift-{i}-{k}"));
            p.inner.drift(&mut p.values, &mut s, 0);
            p.inner.drift(&mut p.values, &mut s, pd.stability_days * DAY);
            assert_eq!(p.values, was.values);
        }
        let mut one = person("month");
        let was = one.values;
        let mut s = |k: &str| rng(&format!("m-{k}"));
        one.inner.drift(&mut one.values, &mut s, 0);
        one.inner.drift(&mut one.values, &mut s, 30 * DAY);
        assert!(Value::ALL.iter().map(|v| (one.values[v.index()] - was[v.index()]).abs()).max().unwrap() < 1_500);
    }

    #[test]
    fn a_shock_moves_values_by_closeness_dents_heal_and_it_is_remembered() {
        let mut p = person("s");
        let was = p.values;
        let s = d().values.shock_bps;
        p.inner.happened(&mut p.values, "bereaved", 1_000, Happening { about: Some("c0002".into()), ..Default::default() });
        let dv = |p: &P, v: Value| p.values[v.index()] - was[v.index()];
        assert_eq!((dv(&p, Value::Security), dv(&p, Value::Tradition), dv(&p, Value::Stimulation), dv(&p, Value::Achievement)), (s, s, -s, 0));
        let dent = d().needs.dents["bereaved"];
        assert_eq!(p.inner.dent(Need::Meaning, 1_000), dent.meaning.unwrap());
        assert_eq!(p.inner.dent(Need::Belonging, 1_000), dent.belonging.unwrap());
        assert_eq!(p.inner.dent(Need::Meaning, 1_000 + d().needs.dent_half_life_days * DAY), dent.meaning.unwrap() / 2);
        assert_eq!(p.inner.sections().memory.defining, [Remembered { t: 1_000, what: "bereaved".into(), about: Some("c0002".into()), size: 5_000, by: None }]);
        let mut far = person("s2");
        let was_far = far.values;
        far.inner.happened(&mut far.values, "bereaved", 0, Happening { closeness_bps: Some(5_000), ..Default::default() });
        assert_eq!(far.values[Value::Security.index()] - was_far[Value::Security.index()], s / 2);
        assert_eq!(far.inner.dent(Need::Meaning, 0), dent.meaning.unwrap() / 2);
        let mut mother = person("s3");
        let was_m = mother.values;
        mother.inner.happened(&mut mother.values, "child", 0, Happening::default());
        assert_eq!(mother.values[Value::Conformity.index()] - was_m[Value::Conformity.index()], s);
        assert_eq!(mother.values[Value::Hedonism.index()] - was_m[Value::Hedonism.index()], -s);
        assert_eq!(mother.inner.dent(Need::Meaning, 0), 0);
    }

    #[test]
    fn memory_is_bounded() {
        let mut p = person("m");
        for i in 0..500 {
            let big = i % 50 == 0;
            p.inner.remember(Remembered { t: i, what: if big { "bereaved" } else { "talked" }.into(), size: if big { 5_000 + i } else { 100 }, ..Default::default() });
        }
        let m = p.inner.sections().memory;
        assert_eq!(m.recent.len(), d().memory.recent);
        assert_eq!(m.recent.last().unwrap().t, 499);
        let mut sizes: Vec<i64> = m.defining.iter().map(|x| x.size).collect();
        sizes.sort();
        assert_eq!(sizes, [5_300, 5_350, 5_400, 5_450]);
        assert!(p.inner.take_since().len() <= 16);
        assert_eq!(p.inner.take_since(), []);
    }

    #[test]
    fn attachments_grow_fade_and_give_way() {
        let mut p = person("at");
        let a = d().attach;
        p.inner.attach(Bond::Trade, Some("retail"), 0);
        p.inner.settle(0);
        assert_eq!(p.inner.attached_to(Bond::Trade, None), 0);
        p.inner.attach(Bond::Trade, Some("retail"), a.trade_half_life_days * DAY);
        p.inner.settle(a.trade_half_life_days * DAY);
        assert_eq!(p.inner.attached_to(Bond::Trade, Some("retail")), 5_000);
        assert_eq!(p.inner.attached_to(Bond::Trade, Some("mining")), 0);
        let t1 = (a.trade_half_life_days + a.fade_half_life_days) * DAY;
        p.inner.attach(Bond::Trade, None, t1);
        p.inner.settle(t1);
        assert_eq!(p.inner.attached_to(Bond::Trade, None), 2_500);
        let t2 = t1 + 5 * a.fade_half_life_days * DAY;
        p.inner.attach(Bond::Trade, Some("mining"), t2);
        assert_eq!(p.inner.sections().attached["trade"], Attachment { to: "mining".into(), bps: 0, since: t2 });
        p.inner.start_attached(Bond::Place, "town", a.place_half_life_days, t2);
        assert_eq!(p.inner.attached_to(Bond::Place, Some("town")), 5_000);
    }

    #[test]
    fn a_childs_values_come_from_those_who_raise_them_and_the_spread_is_unchanged() {
        let pop = pop();
        let parents: Vec<[Values; 2]> = (0..1_500).map(|i| [draw_values(&mut rng(&format!("pa-{i}")), &pop), draw_values(&mut rng(&format!("pb-{i}")), &pop)]).collect();
        let kids: Vec<Values> = parents.iter().enumerate().map(|(i, ps)| raised_values(&mut rng(&format!("kid-{i}")), &pop, ps, UPBRINGING_SHARE_BPS)).collect();
        let lone: Vec<Values> = parents.iter().enumerate().map(|(i, ps)| raised_values(&mut rng(&format!("lone-{i}")), &pop, &ps[..1], UPBRINGING_SHARE_BPS)).collect();
        for v in [Value::Security, Value::Universalism] {
            let i = v.index();
            let mid: Vec<f64> = parents.iter().map(|ps| (ps[0][i] + ps[1][i]) as f64 / 2.0).collect();
            let col = |g: &[Values]| g.iter().map(|k| k[i] as f64).collect::<Vec<_>>();
            assert!(corr(&mid, &col(&kids)) > 0.25);
            assert!(corr(&parents.iter().map(|ps| ps[0][i] as f64).collect::<Vec<_>>(), &col(&lone)) > 0.4);
            for g in [&kids, &lone] {
                assert!((sd(&col(g)) - pop.of(v).sd_bps as f64).abs() < 120.0);
                assert!((mean(&col(g)) - pop.of(v).mean_bps as f64).abs() < 120.0);
            }
        }
        let alone: Vec<f64> = (0..800).map(|i| raised_values(&mut rng(&format!("al-{i}")), &pop, &[], UPBRINGING_SHARE_BPS)[Value::Security.index()] as f64).collect();
        assert!((sd(&alone) - 1_500.0).abs() < 150.0);
    }

    #[test]
    fn whatever_happens_the_sections_stay_within_bounds_and_a_saved_record_steps_the_same() {
        let mut p = person("long");
        let mut r = rng("long");
        let whats = ["bereaved", "job_lost", "evicted", "ruined", "child", "turned_away", "hired", "talked"];
        let (mut largest, mut first) = (0, 0);
        let mut saved: Option<(Inner, Values, Rng)> = None;
        let week_of = |p: &mut P, r: &mut Rng, week: i64| -> usize {
            let t = week * 7 * DAY;
            p.inner.settle(t);
            let mut s = |k: &str| rng(&format!("long-{k}"));
            p.inner.drift(&mut p.values, &mut s, t);
            let what = whats[r.below(whats.len() as u64) as usize];
            let about = format!("c{}", r.below(900));
            let closeness = r.below(101) as i64 * 100;
            p.inner.happened(&mut p.values, what, t, Happening { about: Some(about), closeness_bps: Some(closeness), size: None });
            let office = format!("office-{}", r.below(300));
            let (good, heard) = (r.below(2) == 0, r.below(2) == 0);
            p.inner.experience(&p.values, &office, "civil_service", good, t, Experienced { heard, ..Default::default() });
            let boss = format!("boss-{}", r.below(50));
            let think = r.below(20_001) as i64 - 10_000;
            let pr = Pressure { dependence: r.below(10_001) as i64, fear: r.below(10_001) as i64, trust: r.below(10_001) as i64, norm: Some(r.below(20_001) as i64 - 10_000) };
            p.inner.view(&p.values, &boss, think, pr);
            let trade = if r.below(3) != 0 { Some(format!("trade-{}", r.below(4))) } else { None };
            p.inner.attach(Bond::Trade, trade.as_deref(), t);
            p.inner.attach(Bond::Place, Some("town"), t);
            p.inner.tried(r.below(2) == 0, 10_000, None);
            p.inner.spent(["work", "home", "away"][r.below(3) as usize], 7 * DAY);
            let s = p.inner.sections();
            let hours = p.inner.take_hours(t);
            p.inner.take_since();
            assert!(s.trust.len() <= 12 && s.views.len() <= 4 && s.memory.recent.len() + s.memory.defining.len() <= 12);
            serde_json::to_string(&(s, hours)).unwrap().len()
        };
        for week in 0..5_000 {
            if week == 1_000 {
                saved = Some((serde_json::from_str(&serde_json::to_string(&p.inner).unwrap()).unwrap(), p.values, r.clone()));
            }
            largest = largest.max(week_of(&mut p, &mut r, week));
            if week == 2_500 {
                first = largest;
            }
        }
        assert!((largest as f64) < first as f64 * 1.03);
        // A record saved at week 1,000 and stepped again from there ends as the original did.
        let (inner, values, mut r2) = saved.unwrap();
        let mut q = P { values, inner };
        for week in 1_000..5_000 {
            week_of(&mut q, &mut r2, week);
        }
        assert_eq!((q.inner, q.values), (p.inner, p.values));
    }

    #[test]
    fn leaving_on_an_order_weighs_as_being_made_to_leave() {
        let same = |a: &str, b: &str| {
            let (mut x, mut y) = (person("same"), person("same"));
            x.inner.happened(&mut x.values, a, 40 * DAY, Happening { about: Some("landlord-1".into()), ..Default::default() });
            y.inner.happened(&mut y.values, b, 40 * DAY, Happening { about: Some("landlord-1".into()), ..Default::default() });
            assert_eq!(x.values == y.values, a == "left_on_order");
            (x.inner.sections(), y.inner.sections())
        };
        let (left, evicted) = same("left_on_order", "evicted");
        assert_eq!((&left.agency, &left.trust, &left.attached, &left.views), (&evicted.agency, &evicted.trust, &evicted.attached, &evicted.views));
        assert_eq!(left.memory.defining.iter().map(|m| m.what.as_str()).collect::<Vec<_>>(), ["left_on_order"]);
        assert_eq!(evicted.memory.defining.iter().map(|m| m.what.as_str()).collect::<Vec<_>>(), ["evicted"]);
        assert_eq!(left.memory.defining[0].size, evicted.memory.defining[0].size);
        assert_eq!(same("something_else", "evicted").0.memory.defining, []);
    }

    #[test]
    fn params_merge_over_the_defaults_as_ts_does() {
        let p = inner_params(&serde_json::json!({ "trust": { "kept": 5 }, "needs": { "dents": { "fired": { "meaning": 900 } } }, "values": { "shocks": { "child": { "security": -1 } } } }));
        assert_eq!((p.trust.kept, p.trust.start_bps), (5, 5_000));
        assert_eq!(p.needs.dents["fired"], Dent { belonging: None, meaning: Some(900) });
        assert!(p.needs.dents.contains_key("bereaved"));
        assert_eq!(p.values.shocks["child"].len(), 1);
        assert!(p.values.shocks.contains_key("ruined"));
        assert_eq!(inner_params(&serde_json::Value::Null), inner_defaults());
    }
}
