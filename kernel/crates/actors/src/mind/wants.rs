//! participants/src/behaviour/wants.ts, in Rust (lane A2): what an entity is trying to bring about, and how a want
//! meets an opening (docs/design/ai-citizens.md 10a, 10b). Needs say how things are; a want says what the entity
//! means to do about it. Arithmetic and matching only: no model, no clock, no draw.
//!
//! No verb is listed per want. A want names what would satisfy it in the world's own typed outcomes (2c): money to
//! me, money from me (less of it), occupancy, work, attend, goods; and, where a paper stands in the way (a notice, a
//! rise, a debt), that paper and who made it. An opening is anything the entity can see, reduced to what taking it
//! up would bring in the same terms. They meet when the opening brings what the want seeks.
//!
//! Every size is a parameter (`wants`, docs/behaviour/citizen.md "Wants and initiative"); unless that table names a
//! source, a size is a PLACEHOLDER. Basis points throughout, so a record is whole numbers.
//!
//! Decided fresh (the TS relied on JavaScript here):
//! - Weights, times and counts are `i64`; the only floats are the `sway` sizes (parameters, shares like 0.3, never
//!   stored in a record), a person's `patience` and `persistence` (standard-deviation style traits passed in) and
//!   `z` in `swayed`; each is used inside one computation and rounded with `math::round` (JavaScript's `Math.round`).
//! - TS passed `Want` objects by reference and mutated them. Here a method that changes a held want
//!   (`tried`, `met`, `give_up`, `worn_out`) is given the want and finds the held one by its identity (`id_of`:
//!   about, then the paper's record or whom); `due` and `born` return copies. After a call, read the want again with
//!   `get`/`all`. A want not held is left alone (`worn_out` then says nothing).
//! - `born` takes a whole `Want` and starts `tried` and `grown` at 0 (TS: `Omit<Want, "tried" | "grown">`).
//! - Sorting is stable with the id (byte order; ids are ASCII) as the last key, as TS's comparator.
//! - A displaced want with `kept` = 0 is the newborn itself (JavaScript's `splice(-1, 1)` removes the last).
//! - The `rested` and `copied` tables are only looked up, never iterated, so `BTreeMap`.

use super::math;
use super::person::Need;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const DAY: i64 = 86_400;

/// What a want seeks, as a typed outcome of 2c seen from the one who wants it. Serialised by TS's dotted names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum SeekKey {
    #[serde(rename = "money.to")]
    MoneyTo,
    #[serde(rename = "money.from")]
    MoneyFrom,
    #[serde(rename = "occupancy")]
    Occupancy,
    #[serde(rename = "work")]
    Work,
    #[serde(rename = "attend")]
    Attend,
    #[serde(rename = "goods")]
    Goods,
}

pub const SEEK_KEYS: [SeekKey; 6] = [SeekKey::MoneyTo, SeekKey::MoneyFrom, SeekKey::Occupancy, SeekKey::Work, SeekKey::Attend, SeekKey::Goods];

impl SeekKey {
    /// TS's name for it ("money.to" ...).
    pub fn name(self) -> &'static str {
        match self {
            SeekKey::MoneyTo => "money.to",
            SeekKey::MoneyFrom => "money.from",
            SeekKey::Occupancy => "occupancy",
            SeekKey::Work => "work",
            SeekKey::Attend => "attend",
            SeekKey::Goods => "goods",
        }
    }
}

/// A seek as a record holds it: the outcome of 2c, with "me" where the entity itself stands.
pub fn seek_shape(k: SeekKey) -> Value {
    match k {
        SeekKey::MoneyTo => json!({ "money": { "to": "me" } }),
        SeekKey::MoneyFrom => json!({ "money": { "from": "me" } }),
        SeekKey::Occupancy => json!({ "occupancy": { "who": "me" } }),
        SeekKey::Work => json!({ "work": { "by": "me" } }),
        SeekKey::Attend => json!({ "attend": { "who": "me" } }),
        SeekKey::Goods => json!({ "goods": { "to": "me" } }),
    }
}

/// What each need is met by, in the world's typed outcomes (`SEEKS_OF_NEED`, indexed by `Need::index`): the
/// appraisal of mind.ts read the other way. Belonging and meaning are met by taking part and by work of one's own.
pub const SEEKS_OF_NEED: [&[SeekKey]; 7] = [
    &[SeekKey::Goods, SeekKey::MoneyTo],      // subsistence
    &[SeekKey::Occupancy],                    // shelter
    &[SeekKey::MoneyTo, SeekKey::MoneyFrom],  // security
    &[SeekKey::Attend],                       // social
    &[SeekKey::Work],                         // status
    &[SeekKey::Attend],                       // belonging
    &[SeekKey::Attend, SeekKey::Work],        // meaning
];

pub fn seeks_of_need(n: Need) -> &'static [SeekKey] {
    SEEKS_OF_NEED[n.index()]
}

/// A paper that stands in the way of a want: what it is (its kind), which one, and who made it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Against {
    pub record: String,
    pub kind: String,
    pub by: String,
}

/// Born of a need as values weigh it, of something that happened, or of what someone one copies is after.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Need,
    Event,
    Other,
}

impl Origin {
    pub fn name(self) -> &'static str {
        match self {
            Origin::Need => "need",
            Origin::Event => "event",
            Origin::Other => "other",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Want {
    /// What it is about, in a word of the mind's own: a need (security, shelter ...), or what happened
    /// (rent_increase, notice, let_go, loss, slight ...). With `against.record` it is the want's identity.
    pub about: String,
    pub seeks: Vec<SeekKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<Against>,
    /// Whom it concerns, where it is about someone (a person, an organisation or a post). A want may seek nothing
    /// typed and be about someone only; anything that bears on them is then an opening.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whom: Option<String>,
    /// How much it matters (basis points).
    pub weight: i64,
    pub since: i64,
    pub from: Origin,
    /// The household it is held with, where it is a household's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub with: Option<String>,
    /// How often something was tried for it, when last, and the way taken (an opening's key; "wait": nothing).
    pub tried: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tried_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub way: Option<String>,
    /// What the way taken rests on (an opening's id: a request we made, a board we looked at).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
    /// How often it has grown for going unmet.
    pub grown: i64,
}

impl Want {
    /// A want as `born` takes it: nothing tried, nothing grown, nothing against, no one it concerns.
    pub fn new(about: &str, seeks: Vec<SeekKey>, weight: i64, since: i64, from: Origin) -> Want {
        Want { about: about.into(), seeks, against: None, whom: None, weight, since, from, with: None, tried: 0, tried_at: None, way: None, on: None, grown: 0 }
    }
}

/// What moves the choice among ways (basis points of the mind's payoff scale), `WantParams.choice`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    /// What a way not yet tried is expected to give (EWA's initial attraction).
    pub expect: i64,
    /// How much a standard deviation of trust, against the town's figure for its kind, counts for turning to it.
    pub trust: i64,
    /// How much fear of someone one depends on counts against confronting them.
    pub fear: i64,
    /// How much a standard deviation of the sense of agency counts for acting at all against waiting.
    pub agency: i64,
    /// How much holding what a host teaches counts for turning to it.
    pub belief: i64,
    /// How much each person known to have taken a way counts.
    pub others: i64,
    pub own: i64,
    /// What the bother of taking something to a venue counts against it, beside its fee. FITTED to the share of
    /// people with a problem who turn to an authority or third party (docs/behaviour/frictions.md).
    pub venue: i64,
}

/// How far a standard deviation of trust, agency and attachment sways the cited rates they are read by (shares of
/// the rate, so floats: parameters, never stored in a record).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sway {
    pub trust: f64,
    pub agency: f64,
    pub attachment: f64,
    /// How far wanting work of one's own raises the month's chance of founding a business (a share of it).
    pub found: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WantParams {
    /// How many a record keeps (the lightest gives way).
    pub kept: i64,
    /// A need below this for `unmet_days` becomes a want (by need; `other` for the rest). PLACEHOLDERS.
    pub unmet_bps: BTreeMap<String, i64>,
    pub unmet_days: i64,
    /// A need-born want is met once the need is back above its level by this much.
    pub met_margin_bps: i64,
    /// How long a way is given before the want is looked at again, at the middle of temperament.
    pub patience_days: i64,
    /// After this many tries unmet, the want grows or is given up, by temperament.
    pub tries: i64,
    /// Growing: this share more weight, at most `grows` times.
    pub grow_bps: i64,
    pub grows: i64,
    /// After giving one up, the same want is not born again for this long.
    pub rest_days: i64,
    /// An event-born want's weight at full size, and a need-born one's at a need wholly unmet.
    pub event_bps: i64,
    pub need_bps: i64,
    /// How many of those one knows must be after something before one short of it too takes the want up.
    pub copy_from: i64,
    pub choice: Choice,
    pub sway: Sway,
    /// Asking the other party to an agreement to vary it: at most once in this long for the same agreement.
    pub ask_again_days: i64,
    /// A rise asked for, as a share of the wage.
    pub rise_bps: i64,
    /// How long an answer is waited for before the paper asked about is dealt with as it stands.
    pub answer_days: i64,
}

/// `WANT_DEFAULTS`.
pub fn want_defaults() -> WantParams {
    WantParams {
        kept: 6,
        unmet_bps: [("security", 3_000), ("social", 4_000), ("subsistence", 0), ("other", 2_500)].into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
        unmet_days: 60,
        met_margin_bps: 500,
        patience_days: 45,
        tries: 3,
        grow_bps: 2_500,
        grows: 2,
        rest_days: 180,
        event_bps: 6_000,
        need_bps: 6_000,
        copy_from: 2,
        choice: Choice { expect: 5_000, trust: 1_500, fear: 3_000, agency: 1_500, belief: 3_000, others: 500, own: 500, venue: 1_500 },
        sway: Sway { trust: 0.3, agency: 0.3, attachment: 0.3, found: 1.0 },
        ask_again_days: 365,
        rise_bps: 500,
        answer_days: 14,
    }
}

impl Default for WantParams {
    fn default() -> Self {
        want_defaults()
    }
}

fn int_of(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    v.as_i64().or_else(|| v.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9e15).map(|f| f as i64))
}

/// `wantParams(given)`: the world's keys over the defaults (the three tables merged key by key). A key of the wrong
/// type is ignored (TS would carry it along and fail later).
pub fn want_params(given: &Value) -> WantParams {
    let mut p = want_defaults();
    let g = |k: &str| given.get(k);
    macro_rules! ints { ($($f:ident),*) => { $( if let Some(x) = int_of(g(stringify!($f))) { p.$f = x; } )* } }
    ints!(kept, unmet_days, met_margin_bps, patience_days, tries, grow_bps, grows, rest_days, event_bps, need_bps, copy_from, ask_again_days, rise_bps, answer_days);
    if let Some(m) = g("unmet_bps").and_then(Value::as_object) {
        for (k, v) in m {
            if let Some(x) = int_of(Some(v)) {
                p.unmet_bps.insert(k.clone(), x);
            }
        }
    }
    if let Some(c) = g("choice") {
        macro_rules! cints { ($($f:ident),*) => { $( if let Some(x) = int_of(c.get(stringify!($f))) { p.choice.$f = x; } )* } }
        cints!(expect, trust, fear, agency, belief, others, own, venue);
    }
    if let Some(s) = g("sway") {
        macro_rules! sfloats { ($($f:ident),*) => { $( if let Some(x) = s.get(stringify!($f)).and_then(Value::as_f64) { p.sway.$f = x; } )* } }
        sfloats!(trust, agency, attachment, found);
    }
    p
}

/// What undoes a paper: the one paper (`record`), or the kinds of paper it can undo or vary.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Undoes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<String>>,
}

/// An opening: something the entity can see that it could take up, and what that would bring.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Opening {
    /// The way, by how it is taken up and of what: "offer:employment", "offer:lease", "practice", "join:<host>",
    /// "ask:<party>", "desk:<office>", "self", "ties".
    pub key: String,
    /// The kind of way, as the mind learns it: the key without whom.
    pub kind: String,
    /// The record it rests on, where there is one (the offer, the practice, the agreement, the paper).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    /// What taking it up would bring, in typed outcomes. Empty: its terms are words, whose meaning is the mind's.
    pub brings: Vec<SeekKey>,
    /// The kinds of paper it can undo or vary, or the one paper.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undoes: Option<Undoes>,
    /// Whom it bears on: those it would let the entity be heard by, be rid of, stand against or stop dealing with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bears: Option<Vec<String>>,
}

/// JavaScript truthiness of a JSON value (`o.money` in TS is a test of this).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64().map_or(true, |f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JavaScript's `Number(x)` of a JSON number or numeric string (NaN where it is neither).
fn number_of(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() { 0.0 } else { t.parse::<f64>().unwrap_or(f64::NAN) }
        }
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        None | Some(Value::Null) => 0.0,
        _ => f64::NAN,
    }
}

/// What an offer's typed terms would bring whoever takes it up (contracts: Offer; docs/design/ai-citizens.md 2a,
/// 2c). `offer` is the offer as JSON (`terms.commitments[]`, each `who`, `does.outcome`, optional `every` seconds).
/// `pays_now`: what the taker pays a month now for the same kind of thing (a lease's rent); an offer asking less
/// brings money from me. Terms in words bring nothing typed. In `SEEK_KEYS` order.
pub fn brings_of(offer: &Value, pays_now: Option<i64>) -> Vec<SeekKey> {
    let mut out: Vec<SeekKey> = Vec::new();
    let mut add = |k: SeekKey| {
        if !out.contains(&k) {
            out.push(k);
        }
    };
    const MONTH: f64 = (30 * 86_400) as f64;
    let mut asks = 0.0_f64;
    if let Some(cs) = offer.get("terms").and_then(|t| t.get("commitments")).and_then(Value::as_array) {
        for c in cs {
            let Some(o) = c.get("does").and_then(|d| d.get("outcome")).filter(|o| truthy(Some(o))) else { continue };
            let taker = c.get("who").and_then(Value::as_str) == Some("taker");
            let money = truthy(o.get("money"));
            if money && !taker {
                add(SeekKey::MoneyTo);
            }
            if money && taker {
                let amount = number_of(o.get("money").and_then(|m| m.get("amount")));
                let every = number_of(c.get("every"));
                asks += if truthy(c.get("every")) { math::round(amount * MONTH / every) as f64 } else { amount };
            }
            if truthy(o.get("occupancy")) {
                add(if taker { SeekKey::Work } else { SeekKey::Occupancy });
            }
            if truthy(o.get("work")) && taker {
                add(SeekKey::Work);
            }
            if truthy(o.get("goods")) && !taker {
                add(SeekKey::Goods);
            }
            if truthy(o.get("attend")) {
                add(SeekKey::Attend);
            }
        }
    }
    if let Some(p) = pays_now {
        if asks > 0.0 && asks < p as f64 {
            add(SeekKey::MoneyFrom);
        }
    }
    SEEK_KEYS.into_iter().filter(|k| out.contains(k)).collect()
}

/// Whether an opening would bring what a want seeks: an outcome it seeks, or the undoing of the paper in its way.
pub fn meets(w: &Want, o: &Opening) -> bool {
    if let (Some(against), Some(undoes)) = (&w.against, &o.undoes) {
        if let Some(r) = &undoes.record {
            return *r == against.record;
        }
        if undoes.kinds.as_ref().is_some_and(|ks| ks.contains(&against.kind)) {
            return true;
        }
    }
    if let (Some(whom), Some(bears)) = (&w.whom, &o.bears) {
        if bears.contains(whom) {
            return true;
        }
    }
    o.brings.iter().any(|k| w.seeks.contains(k))
}

fn id_of(w: &Want) -> String {
    match (&w.against, &w.whom) {
        (Some(a), _) => format!("{}:{}", w.about, a.record),
        (None, Some(whom)) if !whom.is_empty() => format!("{}:{}", w.about, whom),
        _ => w.about.clone(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WantEventKind {
    Born,
    Pursued,
    Met,
    GivenUp,
    Grown,
    Displaced,
}

/// What became of a want, for whoever records it (nothing here says whether that was good).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WantEvent {
    pub t: i64,
    pub kind: WantEventKind,
    pub want: Want,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub way: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
}

/// What `worn_out` made of a want.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Worn {
    /// It presses harder and is tried again.
    Grown,
    GivenUp,
}

/// One line of the record's section (contracts/entity-record.schema.json).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SectionWant {
    pub about: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whom: Option<String>,
    pub seeks: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub against: Option<Against>,
    pub weight: i64,
    pub since: i64,
    pub from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub with: Option<String>,
    pub tried: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub way: Option<String>,
}

fn nonempty(s: &Option<String>) -> Option<String> {
    s.clone().filter(|x| !x.is_empty())
}

/// An entity's wants: a short, bounded list. `patience` (about 0.5 to 1.5) stretches how long a way is given, and
/// `persistence` (standard deviations: those who value achievement and self-direction, and feel their acts count)
/// decides whether a want long unmet grows or is given up.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wants {
    pub p: std::sync::Arc<WantParams>,
    list: Vec<Want>,
    /// id -> not born again before this time (looked up only).
    rested: BTreeMap<String, i64>,
    /// A want taken up from others and met -> not taken up from them again before this time (looked up only).
    copied: BTreeMap<String, i64>,
    events: Vec<WantEvent>,
}

impl Default for Wants {
    fn default() -> Self {
        Wants::new(want_defaults())
    }
}

impl Wants {
    pub fn new(p: impl Into<std::sync::Arc<WantParams>>) -> Wants {
        let p = p.into();
        Wants { p, list: Vec::new(), rested: BTreeMap::new(), copied: BTreeMap::new(), events: Vec::new() }
    }

    pub fn all(&self) -> &[Want] {
        &self.list
    }

    pub fn get(&self, about: &str, record: Option<&str>) -> Option<&Want> {
        self.list.iter().find(|w| w.about == about && (record.is_none() || w.against.as_ref().map(|a| a.record.as_str()) == record || w.whom.as_deref() == record))
    }

    /// The heaviest want that concerns this one, if any (of equals, the earlier held).
    pub fn about(&self, whom: &str) -> Option<&Want> {
        let mut v: Vec<&Want> = self.list.iter().collect();
        v.sort_by(|a, b| b.weight.cmp(&a.weight));
        v.into_iter().find(|w| w.whom.as_deref() == Some(whom) || w.against.as_ref().is_some_and(|a| a.by == whom))
    }

    pub fn has(&self, about: &str) -> bool {
        self.list.iter().any(|w| w.about == about)
    }

    /// Whether a way of this kind is being taken for some want (the way is the kind, or the kind with a whom).
    pub fn taking(&self, kind: &str) -> bool {
        let prefix = format!("{kind}:");
        self.list.iter().any(|w| w.way.as_ref().is_some_and(|y| y == kind || y.starts_with(&prefix)))
    }

    /// A want is born, or one already held is felt more (the heavier weight stands). Returns a copy of it, or
    /// nothing while the same want rests after being given up. `tried` and `grown` start at 0.
    pub fn born(&mut self, mut w: Want, t: i64) -> Option<Want> {
        let id = id_of(&w);
        if t < self.rested.get(&id).copied().unwrap_or(0) || (w.from == Origin::Other && t < self.copied.get(&id).copied().unwrap_or(0)) {
            return None;
        }
        if let Some(held) = self.list.iter_mut().find(|x| id_of(x) == id) {
            held.weight = held.weight.max(w.weight);
            return Some(held.clone());
        }
        w.weight = w.weight.clamp(1, 10_000);
        w.tried = 0;
        w.grown = 0;
        self.list.push(w.clone());
        self.events.push(WantEvent { t, kind: WantEventKind::Born, want: w.clone(), way: None, why: None });
        if self.list.len() as i64 > self.p.kept {
            // The lightest gives way (of equals, the oldest; never the one just born, unless `kept` is 0).
            let mut drop: Option<usize> = None;
            for i in 0..self.list.len() - 1 {
                if drop.map_or(true, |d| self.list[i].weight < self.list[d].weight) {
                    drop = Some(i);
                }
            }
            let gone = self.list.remove(drop.unwrap_or(self.list.len() - 1));
            self.events.push(WantEvent { t, kind: WantEventKind::Displaced, want: gone, way: None, why: None });
        }
        Some(w)
    }

    /// The wants to act on now: one never tried, or one whose way has had its time. Heaviest first.
    pub fn due(&self, t: i64, patience: f64) -> Vec<Want> {
        let wait = math::round(self.p.patience_days as f64 * DAY as f64 * patience);
        let mut v: Vec<Want> = self.list.iter().filter(|w| w.tried == 0 || t - w.tried_at.unwrap_or(w.since) >= wait).cloned().collect();
        v.sort_by(|a, b| b.weight.cmp(&a.weight).then_with(|| id_of(a).cmp(&id_of(b))));
        v
    }

    fn held_mut(&mut self, w: &Want) -> Option<&mut Want> {
        let id = id_of(w);
        self.list.iter_mut().find(|x| id_of(x) == id)
    }

    /// Something was tried for it (or, with "wait", nothing was).
    pub fn tried(&mut self, w: &Want, way: &str, t: i64, on: Option<&str>) {
        let Some(h) = self.held_mut(w) else { return };
        h.tried += 1;
        h.tried_at = Some(t);
        h.way = Some(way.to_string());
        h.on = on.map(str::to_string);
        let snap = h.clone();
        self.events.push(WantEvent { t, kind: WantEventKind::Pursued, want: snap, way: Some(way.to_string()), why: None });
    }

    pub fn met(&mut self, w: &Want, t: i64, why: Option<&str>) {
        let w = self.drop(w);
        // (A want taken up from others, once met, is not taken up from them again for a while: it would otherwise
        // be born and met week after week by someone who is merely near their aspiration.)
        if w.from == Origin::Other {
            self.copied.insert(id_of(&w), t + self.p.rest_days * DAY);
        }
        let (way, why) = (nonempty(&w.way), why.filter(|s| !s.is_empty()).map(str::to_string));
        self.events.push(WantEvent { t, kind: WantEventKind::Met, want: w, way, why });
    }

    pub fn give_up(&mut self, w: &Want, t: i64, why: Option<&str>) {
        let w = self.drop(w);
        self.rested.insert(id_of(&w), t + self.p.rest_days * DAY);
        let (way, why) = (nonempty(&w.way), why.filter(|s| !s.is_empty()).map(str::to_string));
        self.events.push(WantEvent { t, kind: WantEventKind::GivenUp, want: w, way, why });
    }

    /// A want that has had its tries and is still unmet grows or is given up: which, is temperament. Returns what
    /// became of it, or nothing if it has tries left (or is not held).
    pub fn worn_out(&mut self, w: &Want, t: i64, persistence: f64) -> Option<Worn> {
        let (tries, grows, grow_bps) = (self.p.tries, self.p.grows, self.p.grow_bps);
        let h = self.held_mut(w)?;
        if h.tried < tries * (h.grown + 1) {
            return None;
        }
        if persistence > 0.0 && h.grown < grows {
            h.grown += 1;
            h.weight = math::round(h.weight as f64 * (1.0 + grow_bps as f64 / 10_000.0)).min(10_000);
            let snap = h.clone();
            self.events.push(WantEvent { t, kind: WantEventKind::Grown, want: snap, way: None, why: None });
            return Some(Worn::Grown);
        }
        self.give_up(w, t, Some("nothing worked"));
        Some(Worn::GivenUp)
    }

    /// Takes the held want out (the passed one's own data if it is not held).
    fn drop(&mut self, w: &Want) -> Want {
        let id = id_of(w);
        match self.list.iter().position(|x| id_of(x) == id) {
            Some(i) => self.list.remove(i),
            None => w.clone(),
        }
    }

    /// What has become of wants since this was last asked.
    pub fn take(&mut self) -> Vec<WantEvent> {
        std::mem::take(&mut self.events)
    }

    /// The record's section: heaviest first, whole numbers.
    pub fn section(&self) -> Vec<SectionWant> {
        let mut v: Vec<&Want> = self.list.iter().collect();
        v.sort_by(|a, b| b.weight.cmp(&a.weight).then_with(|| id_of(a).cmp(&id_of(b))));
        v.into_iter()
            .map(|w| SectionWant {
                about: w.about.clone(),
                whom: nonempty(&w.whom),
                seeks: w.seeks.iter().map(|k| seek_shape(*k)).collect(),
                against: w.against.clone(),
                weight: w.weight,
                since: w.since,
                from: w.from.name().to_string(),
                with: nonempty(&w.with),
                tried: w.tried,
                way: nonempty(&w.way),
            })
            .collect()
    }
}

/// A rate swayed by where a person stands against their town (docs/behaviour/citizen.md, "Readers"): `z` standard
/// deviations from the town's mean (held to three), `per` the share of the rate a standard deviation moves it.
/// Symmetric, so the town's rate stays where it is calibrated while people differ.
pub fn swayed(bps: i64, z: f64, per: f64) -> i64 {
    math::clamp_bps(bps as f64 * (1.0 + per * z.clamp(-3.0, 3.0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONTH: i64 = 30 * DAY;

    fn posting() -> Value {
        json!({ "terms": { "commitments": [
            { "who": "shop-3", "does": { "outcome": { "money": { "from": "acc-shop-3", "amount": "211356", "for": "wages" } } }, "every": 14 * DAY },
            { "who": "taker", "does": { "outcome": { "work": { "task": "serve", "at": "shop-3-premises", "hours": 273_600 } } }, "every": 14 * DAY }] } })
    }
    fn listing(rent: i64) -> Value {
        json!({ "terms": { "commitments": [
            { "who": "landlord-1", "does": { "outcome": { "occupancy": { "in": "apts-1/dwelling.2" } } } },
            { "who": "taker", "does": { "outcome": { "money": { "to": "acc-landlord-1", "amount": rent.to_string() } } }, "every": MONTH }] } })
    }
    fn membership() -> Value {
        json!({ "terms": { "commitments": [
            { "who": "union", "does": { "text": "Represents the member at work, and bargains for them." } },
            { "who": "taker", "does": { "outcome": { "money": { "to": "acc-union", "amount": "2000" } } }, "every": MONTH }] } })
    }
    fn want(about: &str, seeks: &[SeekKey]) -> Want {
        Want::new(about, seeks.to_vec(), 5_000, 0, Origin::Event)
    }
    fn opening(key: &str, kind: &str, brings: &[SeekKey]) -> Opening {
        Opening { key: key.into(), kind: kind.into(), id: None, by: None, brings: brings.to_vec(), undoes: None, bears: None }
    }
    fn need_want(about: &str, seeks: &[SeekKey], weight: i64, from: Origin) -> Want {
        Want::new(about, seeks.to_vec(), weight, 0, from)
    }

    #[test]
    fn what_an_offer_brings_is_read_from_its_typed_terms() {
        use SeekKey::*;
        assert_eq!(brings_of(&posting(), None), vec![MoneyTo, Work]);
        assert_eq!(brings_of(&listing(100_000), None), vec![Occupancy]);
        assert_eq!(brings_of(&listing(90_000), Some(100_000)), vec![MoneyFrom, Occupancy]);
        assert_eq!(brings_of(&listing(110_000), Some(100_000)), vec![Occupancy]);
        assert_eq!(brings_of(&membership(), None), vec![]);
        assert_eq!(brings_of(&Value::Null, None), vec![]);
        // A rent asked a fortnight at a time is a month's by the same reckoning.
        let fortnightly = json!({ "terms": { "commitments": [{ "who": "taker", "does": { "outcome": { "money": { "amount": 40_000 } } }, "every": 14 * DAY }] } });
        assert_eq!(brings_of(&fortnightly, Some(100_000)), vec![MoneyFrom]); // 40,000 x 30/14 = 85,714
    }

    #[test]
    fn a_want_and_an_opening_meet_by_the_outcome_sought_the_paper_in_the_way_or_whom_it_concerns() {
        use SeekKey::*;
        let board = opening("offer:employment", "offer:employment", &[MoneyTo, Work]);
        let mut landlord = opening("ask:landlord-1", "ask", &[]);
        landlord.undoes = Some(Undoes { record: Some("inc-1".into()), kinds: None });
        landlord.bears = Some(vec!["landlord-1".into()]);
        let mut desk = opening("desk:tribunal", "desk", &[]);
        desk.undoes = Some(Undoes { record: None, kinds: Some(vec!["rent_increase".into(), "debt".into()]) });
        let mut union = opening("join:union", "join", &[]);
        union.bears = Some(vec!["factory-1".into()]);
        let all = [&board, &landlord, &desk, &union];

        let mut rise = want("rent_increase", &[MoneyFrom]);
        rise.whom = Some("landlord-1".into());
        rise.against = Some(Against { record: "inc-1".into(), kind: "rent_increase".into(), by: "landlord-1".into() });
        assert_eq!(all.map(|o| meets(&rise, o)), [false, true, true, false]);
        assert!(meets(&want("x", &[Work, MoneyTo]), &board));
        let mut grievance = want("unpaid", &[]);
        grievance.whom = Some("factory-1".into());
        assert_eq!(all.map(|o| meets(&grievance, o)), [false, false, false, true]);
        let mut slight = want("slight", &[]);
        slight.whom = Some("st-marks".into());
        assert!(!all.iter().any(|o| meets(&slight, o)));
    }

    #[test]
    fn a_record_keeps_six_wants_the_lightest_gives_way_and_what_became_of_each_is_told_once() {
        let mut w = Wants::default();
        for i in 0..7 {
            w.born(Want::new(&format!("n{i}"), vec![SeekKey::Attend], 1_000 + i * 100, i, Origin::Need), i);
        }
        let held: Vec<&str> = w.all().iter().map(|x| x.about.as_str()).collect();
        assert_eq!(held, ["n1", "n2", "n3", "n4", "n5", "n6"]);
        let told: Vec<String> = w.take().iter().map(|e| format!("{:?}:{}", e.kind, e.want.about)).collect();
        assert_eq!(told, ["Born:n0", "Born:n1", "Born:n2", "Born:n3", "Born:n4", "Born:n5", "Born:n6", "Displaced:n0"]);
        assert!(w.take().is_empty());
        let s = &w.section()[0];
        assert_eq!((s.about.as_str(), s.weight, s.since, s.from.as_str(), s.tried), ("n6", 1_600, 6, "need", 0));
        assert_eq!(s.seeks, vec![json!({ "attend": { "who": "me" } })]);
        // Born again while held: felt at least as much, not twice.
        w.born(need_want("n6", &[SeekKey::Attend], 3_000, Origin::Need), 9);
        assert_eq!(w.all().len(), 6);
        assert_eq!(w.get("n6", None).unwrap().weight, 3_000);
        // A lighter one born again does not lighten it.
        w.born(need_want("n6", &[SeekKey::Attend], 100, Origin::Need), 10);
        assert_eq!(w.get("n6", None).unwrap().weight, 3_000);
    }

    #[test]
    fn a_want_is_due_then_grows_for_the_persistent_and_is_given_up_by_the_rest_and_rests() {
        let rest = want_defaults().rest_days;
        let sec = |a: &Wants| a.get("security", None).unwrap().clone();
        let mut w = Wants::default();
        let a = w.born(need_want("security", &[SeekKey::MoneyTo], 4_000, Origin::Need), 0).unwrap();
        assert_eq!(w.due(0, 1.0).len(), 1);
        w.tried(&a, "self", 0, None);
        assert!(w.due(44 * DAY, 1.0).is_empty());
        assert_eq!(w.due(45 * DAY, 1.0).len(), 1);
        assert!(w.due(60 * DAY, 1.5).is_empty());
        assert_eq!(w.worn_out(&a, 45 * DAY, 1.0), None);
        w.tried(&a, "offer:employment", 45 * DAY, None);
        w.tried(&a, "wait", 90 * DAY, None);
        assert!(!w.taking("offer:employment"));
        assert!(w.taking("wait"));
        // Three tries: the persistent want it more.
        assert_eq!(w.worn_out(&a, 135 * DAY, 0.5), Some(Worn::Grown));
        assert_eq!(sec(&w).weight, 5_000);
        assert_eq!(w.worn_out(&a, 135 * DAY, 0.5), None); // three more tries first
        // The same want in someone who is not: given up, and not born again for a while.
        let mut v = Wants::default();
        let b = v.born(need_want("security", &[SeekKey::MoneyTo], 4_000, Origin::Need), 0).unwrap();
        for i in 0..3 {
            v.tried(&b, "self", i * 45 * DAY, None);
        }
        assert_eq!(v.worn_out(&b, 135 * DAY, -0.5), Some(Worn::GivenUp));
        assert!(v.all().is_empty());
        assert!(v.born(need_want("security", &[SeekKey::MoneyTo], 4_000, Origin::Need), 200 * DAY).is_none());
        assert!(v.born(need_want("security", &[SeekKey::MoneyTo], 4_000, Origin::Need), (135 + rest) * DAY).is_some());
        let kinds: Vec<WantEventKind> = v.take().iter().map(|e| e.kind).collect();
        use WantEventKind::*;
        assert_eq!(kinds, [Born, Pursued, Pursued, Pursued, GivenUp, Born]);
    }

    #[test]
    fn a_want_taken_up_from_others_once_met_is_not_taken_up_from_them_again_for_a_while() {
        let rest = want_defaults().rest_days;
        let mut w = Wants::default();
        let a = w.born(need_want("social", &[SeekKey::Attend], 1_000, Origin::Other), 0).unwrap();
        w.met(&a, 7 * DAY, None);
        assert!(w.born(need_want("social", &[SeekKey::Attend], 1_000, Origin::Other), 14 * DAY).is_none());
        assert!(w.born(need_want("social", &[SeekKey::Attend], 1_000, Origin::Other), (7 + rest) * DAY).is_some());
        // The need itself, short for long, makes it their own want whenever that comes.
        assert!(w.born(need_want("social", &[SeekKey::Attend], 2_000, Origin::Need), 14 * DAY).is_some());
        // One's own, met, may come back as soon as the need does.
        let b = w.born(need_want("security", &[SeekKey::MoneyTo], 1_000, Origin::Need), 0).unwrap();
        w.met(&b, 7 * DAY, None);
        assert!(w.born(need_want("security", &[SeekKey::MoneyTo], 1_000, Origin::Need), 14 * DAY).is_some());
    }

    #[test]
    fn a_sway_is_symmetric_about_the_towns_mean() {
        assert_eq!(swayed(3_000, 0.0, 0.3), 3_000);
        assert_eq!(swayed(3_000, 1.0, 0.3) - 3_000, 3_000 - swayed(3_000, -1.0, 0.3));
        assert_eq!(swayed(3_000, 10.0, 0.3), swayed(3_000, 3.0, 0.3)); // held to three standard deviations
        assert_eq!(swayed(9_000, 3.0, 0.3), 10_000);
    }

    #[test]
    fn names_params_and_shapes_are_ts() {
        assert_eq!(serde_json::to_value(SEEK_KEYS).unwrap(), json!(["money.to", "money.from", "occupancy", "work", "attend", "goods"]));
        assert_eq!(seeks_of_need(Need::Meaning), &[SeekKey::Attend, SeekKey::Work]);
        assert_eq!(want_params(&json!({})), want_defaults());
        let p = want_params(&json!({ "kept": 4, "unmet_bps": { "social": 1 }, "choice": { "venue": 7 }, "sway": { "found": 2.0 } }));
        assert_eq!((p.kept, p.unmet_bps["social"], p.unmet_bps["security"], p.choice.venue, p.choice.own, p.sway.found, p.sway.trust), (4, 1, 3_000, 7, 500, 2.0, 0.3));
        // `kept` is respected.
        let mut w = Wants::new(p);
        for i in 0..5 {
            w.born(need_want(&format!("n{i}"), &[], 1_000 + i, Origin::Need), i);
        }
        assert_eq!(w.all().len(), 4);
    }

    #[test]
    fn a_saved_record_steps_as_before() {
        let mut a = Wants::default();
        let x = a.born(need_want("security", &[SeekKey::MoneyTo], 4_000, Origin::Need), 0).unwrap();
        a.tried(&x, "self", 0, Some("req.1"));
        let y = a.born(need_want("social", &[SeekKey::Attend], 1_000, Origin::Other), 5).unwrap();
        a.met(&y, 9 * DAY, Some("fine"));
        let mut b: Wants = serde_json::from_value(serde_json::to_value(&a).unwrap()).unwrap();
        assert_eq!(a, b);
        for w in [&mut a, &mut b] {
            let x = w.get("security", None).unwrap().clone();
            w.tried(&x, "wait", 50 * DAY, None);
            w.tried(&x, "wait", 95 * DAY, None);
            assert_eq!(w.worn_out(&x, 95 * DAY, 1.0), Some(Worn::Grown));
            assert!(w.born(need_want("social", &[SeekKey::Attend], 1_000, Origin::Other), 10 * DAY).is_none());
        }
        assert_eq!(a, b);
        assert_eq!(a.take(), b.take());
    }
}
