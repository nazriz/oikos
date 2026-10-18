//! Founding (participants/src/behaviour/founding.ts; docs/behaviour/founding.md; docs/design/ai-citizens.md 10b, 10k
//! step 3), in Rust (lane A2). A person whose want has been given up, or who can see nothing that would answer it, and
//! who knows others in the same case, may start something of their own, put up from blocks that exist: an
//! organisation with a first post, a statement of what it is for, a gathering, an offer of membership, and for some a
//! hearing of grievances. The kernel knows no church, union or club: each is a group whose founder said what it is for.
//!
//! Arithmetic and words only: no model, no clock, no draw but from the stream handed in. Every size is a parameter
//! (`founding`, from the world's profile). Unless docs/behaviour/founding.md names a source, a size is a PLACEHOLDER.
//!
//! Decided fresh (docs/port-guide.md, section 2):
//! - The sway, the lean and the shape odds are parameters kept as `f64` (they are fractions of a chance and whole-number
//!   odds the profile gives); they are never state. `chance_of` and `shape_odds` use them inside one computation and
//!   round with `math::round` (JavaScript's `Math.round`, a half up) before returning whole numbers. The sums are done
//!   in the order TS did them, with plain IEEE `+` and `*` (identical on every machine; no `exp`/`ln`/`powf`).
//! - The standard deviations (`z`) a caller passes are `f64`, as TS's were: they are the caller's computation, rounded
//!   here with the chance they sway.
//! - Maps are `BTreeMap` (the shape odds by what a want is about), the shapes a `Vec` in the dial's order; a draw walks
//!   the options in that order, as TS's did, so the same stream gives the same shape.
//! - The `accept_*` checks read the draft as the contract's typed `Block` (a `publish` always has its `text`; TS's
//!   check for a draft with no words at all can no longer arise, an empty one is still refused). Numbers in a practice
//!   or an offer are read as JavaScript read them (a duration that is not a whole number of days is "not among what was
//!   open"). A missing number prints as `undefined`, as TS's message did.
//! - A text's `slice(0, n)` counts UTF-16 units, as JavaScript's does (`slice16`).

use super::math;
use oikos_contracts::blocks::{Block, Visibility};
use oikos_core::rng::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// The shapes a founded thing may have: each a composition of blocks, none a kind the kernel knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Gathering,
    Fund,
    Cause,
    Business,
}

/// Every shape, in the order TS listed them.
pub const SHAPES: [Shape; 4] = [Shape::Gathering, Shape::Fund, Shape::Cause, Shape::Business];

impl Shape {
    pub fn name(self) -> &'static str {
        match self {
            Shape::Gathering => "gathering",
            Shape::Fund => "fund",
            Shape::Cause => "cause",
            Shape::Business => "business",
        }
    }
    pub fn from_name(s: &str) -> Option<Shape> {
        SHAPES.into_iter().find(|x| x.name() == s)
    }
}

/// How far a standard deviation of each sways the chance (a share of it): openness and achievement; care for others;
/// the sense of agency; how long they have lived here; how many they are close to. PLACEHOLDERS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Sway {
    pub enterprise: f64,
    pub care: f64,
    pub agency: f64,
    pub standing: f64,
    pub ties: f64,
}

impl Default for Sway {
    fn default() -> Self {
        Sway { enterprise: 0.3, care: 0.3, agency: 0.3, standing: 0.2, ties: 0.2 }
    }
}

/// A hall the town lets for hire (none: a group stays where it began): the space, whom the booking is told to, the
/// account the hire is paid into, and the hire for one gathering (cents).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hall {
    pub space: String,
    pub town: String,
    pub account: String,
    pub hire: i64,
}

/// A fund: a member of this long may draw, when short, up to this many months' dues, at most once in `every_days`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FundParams {
    pub qualify_days: i64,
    pub draw_months: i64,
    pub every_days: i64,
}

impl Default for FundParams {
    fn default() -> Self {
        FundParams { qualify_days: 60, draw_months: 6, every_days: 180 }
    }
}

/// A body that takes grievances up: the hours a case takes, and the hours a month each member gives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CauseParams {
    pub case_hours: i64,
    pub hours_per_member_month: i64,
    pub answer_days: i64,
}

impl Default for CauseParams {
    fn default() -> Self {
        CauseParams { case_hours: 6, hours_per_member_month: 2, answer_days: 14 }
    }
}

/// The post a founder holds in what they found: its title, channels and module, with "{...}" filled in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostTemplate {
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub channels: Vec<Value>,
    pub role_module: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FoundingParams {
    /// Which shapes may be founded (the world's dial; none: nobody founds anything).
    pub shapes: Vec<Shape>,
    /// The chance that a person of the town's mean temperament and standing, at an occasion (a want given up or with
    /// nothing to answer it, shared by enough others), founds something. FITTED to the place's sourced rate of new
    /// associations per 1,000 residents a year (`per_1000_per_year`, which code never reads).
    pub chance_bps: i64,
    /// The dial's scale on that chance (10,000: as fitted).
    pub scale_bps: i64,
    /// How many others must share the want, as the person knows them. PLACEHOLDER (a critical mass: Marwell and Oliver).
    pub shared_min: i64,
    pub sway: Sway,
    /// The odds of each shape by what the want is about (`other` for the rest), before the person's values lean them.
    pub shape_odds: BTreeMap<String, BTreeMap<String, f64>>,
    /// How far a standard deviation of the values that speak to a shape leans its odds. PLACEHOLDER.
    pub lean: f64,
    /// After founding, or deciding not to at an occasion, the same person does not weigh it again for this long.
    pub rest_days: i64,
    /// What a founder may ask of members, as closed choices: dues a month (cents; the first is the plain default), how
    /// often it gathers, how soon the first, how long. PLACEHOLDERS.
    pub dues: Vec<i64>,
    pub every_days: Vec<i64>,
    pub starts_in_days: Vec<i64>,
    pub lasts_minutes: Vec<i64>,
    /// The hour of the day gatherings start (seconds from midnight).
    pub at_seconds: i64,
    /// A thing nobody joins lapses: fewer than `min_members` besides its founder for this long. PLACEHOLDERS.
    pub lapse_days: i64,
    pub min_members: i64,
    /// A member who has not come for this long gives notice. PLACEHOLDER.
    pub leave_after_days: i64,
    pub hall: Option<Hall>,
    pub fund: FundParams,
    pub cause: CauseParams,
    pub template: Option<PostTemplate>,
    pub bank: String,
}

fn odds(rows: &[(&str, &[(&str, f64)])]) -> BTreeMap<String, BTreeMap<String, f64>> {
    rows.iter().map(|(about, r)| (about.to_string(), r.iter().map(|(s, n)| (s.to_string(), *n)).collect())).collect()
}

/// `FOUNDING_DEFAULTS`: the module's documented defaults (nothing founded; the shapes' odds as docs/behaviour/founding.md).
pub fn founding_defaults() -> FoundingParams {
    FoundingParams::default()
}

impl Default for FoundingParams {
    fn default() -> Self {
        let g = |a: f64, b: f64, c: f64, d: f64| -> [(&'static str, f64); 4] { [("gathering", a), ("fund", b), ("cause", c), ("business", d)] };
        FoundingParams {
            shapes: vec![],
            chance_bps: 0,
            scale_bps: 10_000,
            shared_min: 2,
            sway: Sway::default(),
            shape_odds: odds(&[
                ("loss", &g(8.0, 1.0, 0.0, 0.0)),
                ("meaning", &g(8.0, 0.0, 1.0, 1.0)),
                ("social", &g(9.0, 0.0, 0.0, 0.0)),
                ("belonging", &g(9.0, 0.0, 0.0, 0.0)),
                ("slight", &g(5.0, 0.0, 3.0, 0.0)),
                ("let_go", &g(3.0, 3.0, 2.0, 2.0)),
                ("security", &g(1.0, 6.0, 1.0, 2.0)),
                ("shelter", &g(1.0, 2.0, 6.0, 0.0)),
                ("other", &g(1.0, 2.0, 7.0, 0.0)),
            ]),
            lean: 0.5,
            rest_days: 365,
            dues: vec![0],
            every_days: vec![14, 7, 28],
            starts_in_days: vec![7, 3, 14],
            lasts_minutes: vec![90, 60, 120],
            at_seconds: 19 * 3600,
            lapse_days: 120,
            min_members: 2,
            leave_after_days: 90,
            hall: None,
            fund: FundParams::default(),
            cause: CauseParams::default(),
            template: None,
            bank: String::new(),
        }
    }
}

/// JavaScript's truthiness of a given value (`!given`): null, false, 0, "" and absence are falsy.
fn falsy(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::Bool(b) => !*b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x == 0.0 || x.is_nan()),
        Value::String(s) => s.is_empty(),
        _ => false,
    }
}

/// `foundingParams(given, dial)`: the world's figures merged over the defaults, and the dial's shapes and scale. None
/// when either the figures or the dial are absent (nobody founds anything), or when a given figure is of the wrong kind.
/// Merged as TS merged: every given key replaces the default's, but `sway`, `shape_odds` (by what a want is about),
/// `fund` and `cause` are merged one level in. A given `null` leaves the default.
pub fn founding_params(given: &Value, dial: &Value) -> Option<FoundingParams> {
    if falsy(given) || falsy(dial) {
        return None;
    }
    let g = given.as_object()?;
    let mut all = match serde_json::to_value(FoundingParams::default()).ok()? {
        Value::Object(m) => m,
        _ => return None,
    };
    for (k, v) in g {
        if v.is_null() {
            continue;
        }
        match (k.as_str(), v, all.get_mut(k)) {
            ("sway" | "fund" | "cause" | "shape_odds", Value::Object(add), Some(Value::Object(base))) => {
                for (kk, vv) in add {
                    base.insert(kk.clone(), vv.clone());
                }
            }
            _ => {
                all.insert(k.clone(), v.clone());
            }
        }
    }
    // (The dial's shapes, if it lists them; else the figures'; else all. Only the known shapes are kept, in order.)
    let named = match dial.get("shapes") {
        Some(Value::Array(a)) => Some(a.clone()),
        _ => g.get("shapes").and_then(Value::as_array).cloned(),
    };
    let shapes: Vec<Shape> = match named {
        Some(a) => a.iter().filter_map(|s| s.as_str().and_then(Shape::from_name)).collect(),
        None => SHAPES.to_vec(),
    };
    all.insert("shapes".into(), serde_json::to_value(&shapes).ok()?);
    let scale = dial.get("scale_bps").filter(|v| !v.is_null()).map_or(Some(10_000.0), |v| match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    })?;
    all.insert("scale_bps".into(), json!(math::round(scale)));
    serde_json::from_value(Value::Object(all)).ok()
}

/// A person's standing on what sways their chance of founding, each in standard deviations of the town.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Z {
    pub enterprise: f64,
    pub care: f64,
    pub agency: f64,
    pub standing: f64,
    pub ties: f64,
}

/// The chance of founding at an occasion (basis points), as this person's temperament and standing sway it: symmetric
/// about the town's mean, so the town's rate stays where it is fitted while people differ.
pub fn chance_of(p: &FoundingParams, z: &Z) -> i64 {
    let c = |x: f64| x.min(3.0).max(-3.0);
    let shift = p.sway.enterprise * c(z.enterprise) + p.sway.care * c(z.care) + p.sway.agency * c(z.agency) + p.sway.standing * c(z.standing) + p.sway.ties * c(z.ties);
    let base = (p.chance_bps * p.scale_bps) as f64 / 10_000.0;
    math::round(base * (1.0 + shift).max(0.0)).clamp(0, 10_000)
}

/// Which values speak to which shape (the mapping is ours, to test against data, as an organisation's character is).
fn leans(s: Shape) -> (&'static [&'static str], &'static [&'static str]) {
    match s {
        Shape::Gathering => (&["tradition", "benevolence", "conformity"], &["power"]),
        Shape::Fund => (&["security", "benevolence"], &["stimulation"]),
        Shape::Cause => (&["universalism", "self_direction"], &["conformity"]),
        Shape::Business => (&["achievement", "stimulation", "self_direction"], &["security"]),
    }
}

/// One option in a draw, with its whole-number score.
#[derive(Debug, Clone, PartialEq)]
pub struct Odds<K> {
    pub key: K,
    pub score: i64,
}

/// The odds of each shape that may be founded here, for this want and this person (whole numbers; all 0: none).
/// `z_value`: a value's standard deviations for this person. `able`: a shape that cannot be founded here is `false`.
pub fn shape_odds(p: &FoundingParams, about: &str, has_party: bool, z_value: &dyn Fn(&str) -> f64, able: &BTreeMap<Shape, bool>) -> Vec<Odds<Shape>> {
    let empty = BTreeMap::new();
    let base = p.shape_odds.get(about).or_else(|| p.shape_odds.get("other")).unwrap_or(&empty);
    p.shapes
        .iter()
        .map(|&s| {
            let (plus, minus) = leans(s);
            let z = plus.iter().fold(0.0, |a, v| a + z_value(v)) / plus.len() as f64 - minus.iter().fold(0.0, |a, v| a + z_value(v)) / minus.len() as f64;
            // (A body that takes grievances up needs someone the grievance is against.)
            let can = able.get(&s) != Some(&false) && (s != Shape::Cause || has_party);
            let score = if can {
                math::round(base.get(s.name()).copied().unwrap_or(0.0) * 1_000.0 * (1.0 + p.lean * z.min(3.0).max(-3.0)).max(0.0)).max(0)
            } else {
                0
            };
            Odds { key: s, score }
        })
        .collect()
}

/// A draw among options by their scores, on the stream handed in.
pub fn draw_of<K: Clone>(rng: &mut Rng, options: &[Odds<K>]) -> Option<K> {
    let total: i64 = options.iter().map(|o| o.score).sum();
    if total <= 0 {
        return None;
    }
    let mut x = rng.below(total as u64) as i64;
    for o in options {
        if x < o.score {
            return Some(o.key.clone());
        }
        x -= o.score;
    }
    options.last().map(|o| o.key.clone())
}

/// What a want is about, in the world's own plain words (for a statement written without a model).
pub const MATTER: &[(&str, &str)] = &[
    ("let_go", "being let go from work"),
    ("notice", "being given notice to leave a home"),
    ("rent_increase", "a rise in the rent"),
    ("claim_refused", "a claim for support refused"),
    ("disrepair", "a home left in disrepair"),
    ("bill", "a bill that was wrong"),
    ("goods", "goods that were faulty"),
    ("underpaid", "pay that came short"),
    ("unpaid", "pay that never came"),
    ("loss", "the death of someone close"),
    ("meaning", "wanting something that matters"),
    ("social", "wanting company"),
    ("belonging", "wanting to belong somewhere"),
    ("security", "having nothing to fall back on"),
    ("shelter", "having no home that is secure"),
    ("slight", "being turned away"),
    ("service", "a service the town has not done"),
    ("arrears", "money owed and unpaid"),
    ("status", "wanting work of one's own"),
    ("subsistence", "going short of everyday things"),
];

/// `matterWords`: the plain words for a matter, or the matter itself with its underscores taken out.
pub fn matter_words(about: &str) -> String {
    MATTER.iter().find(|(k, _)| *k == about).map_or_else(|| about.replace('_', " "), |(_, w)| (*w).to_string())
}

/// The founder's want, as the statement and the name are written from it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WantOf {
    pub about: String,
    /// Whom it is against, where anyone (empty: nobody, as in TS where `whom` is falsy).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whom: Option<String>,
}

impl WantOf {
    fn whom(&self) -> Option<&str> {
        self.whom.as_deref().filter(|w| !w.is_empty())
    }
}

/// The statement of purpose code writes with no model: the founder's want in the world's own terms.
pub fn plain_purpose(shape: Shape, want: &WantOf, sharers: i64) -> String {
    let what = matter_words(&want.about);
    // (Someone lost is whom the want is about, not who did it.)
    let by = match want.whom() {
        Some(w) if want.about != "loss" => format!(" at the hands of {w}"),
        _ => String::new(),
    };
    let does = match shape {
        Shape::Fund => "We pay into a common fund, and a member who is short may draw on it.".to_string(),
        Shape::Cause => format!("We take up such matters{} for our members, together.", want.whom().map_or(String::new(), |w| format!(" with {w}"))),
        _ => "We meet, so that nobody has to carry it alone.".to_string(),
    };
    format!("This is for those who know {what}{by}. {sharers} of us began it. {does}")
}

/// The plain name of what a founder founds.
pub fn plain_name(shape: Shape, founder: &str, want: &WantOf) -> String {
    let what = match shape {
        Shape::Fund => "Fund",
        Shape::Cause => "Association",
        _ => "Circle",
    };
    format!("{what} ({}{}; {founder})", want.about.replace('_', " "), want.whom().map_or(String::new(), |w| format!(", {w}")))
}

/// What a want is about that makes a piece a dark one (VISION 15, point 7: counted and reported with every run).
pub const DARK_ABOUT: [&str; 4] = ["loss", "notice", "claim_refused", "shelter"];

/// The piece asked for is a dark one by this rule and no other: what the want is about, or what the record shows of the
/// person. Returns why (none: not dark).
pub fn dark_of(want_about: &str, record: &Value, z_agency: f64) -> Vec<String> {
    let mut why = vec![];
    if DARK_ABOUT.contains(&want_about) {
        why.push(format!("about:{want_about}"));
    }
    let defining: Vec<&str> = record
        .pointer("/memory/defining")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|m| m.get("what").and_then(Value::as_str)).collect())
        .unwrap_or_default();
    for w in ["bereaved", "ruined", "evicted", "left_on_order"] {
        if defining.contains(&w) {
            why.push(format!("lived:{w}"));
        }
    }
    // (`=== 0`: only the number 0.)
    if record.pointer("/circumstances/housed").and_then(Value::as_f64) == Some(0.0) {
        why.push("homeless".into());
    }
    if z_agency <= -1.0 {
        why.push("agency_low".into());
    }
    why
}

/// Text cut to its first `n` UTF-16 units, as JavaScript's `slice(0, n)` (a lone surrogate it would leave is dropped).
pub fn slice16(s: &str, n: usize) -> String {
    let mut used = 0;
    let mut out = String::new();
    for c in s.chars() {
        used += c.len_utf16();
        if used > n {
            break;
        }
        out.push(c);
    }
    out
}

// ---------------------------------------------------------------------------------------------- what a draft may be

/// A drafted publish, its parts (the only block these drafts may be).
struct Pub<'a> {
    text: &'a str,
    offer: Option<&'a Value>,
    practice: Option<&'a Value>,
    speaks_for: Option<&'a str>,
    public: bool,
    addressed: bool,
}

fn one(blocks: &[Block]) -> Result<&Block, String> {
    match blocks {
        [b] => Ok(b),
        _ => Err(format!("a draft of {} acts where one was meant", blocks.len())),
    }
}

fn publication(b: &Block) -> Option<Pub<'_>> {
    match b {
        Block::Publish { text, offer, practice, speaks_for, visible_to, addressed_to, .. } => Some(Pub {
            text,
            offer: offer.as_ref(),
            practice: practice.as_ref(),
            speaks_for: speaks_for.as_deref(),
            public: matches!(visible_to, Some(Visibility::Public(_))),
            addressed: addressed_to.as_ref().is_some_and(|a| !a.is_empty()),
        }),
        _ => None,
    }
}

/// A JSON number as JavaScript prints it in a message (`undefined` where absent).
fn js(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Number(n)) => match n.as_f64() {
            Some(x) if x.fract() == 0.0 && x.abs() < 1e15 => format!("{}", x as i64),
            Some(x) => format!("{x}"),
            None => n.to_string(),
        },
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// Whether `x` (seconds) is a whole count of the unit among those open (JavaScript's `list.includes(x / unit)`).
fn among(list: &[i64], seconds: Option<f64>, unit: f64) -> bool {
    seconds.is_some_and(|s| list.iter().any(|d| *d as f64 == s / unit))
}

/// A draft that founds the organisation: one `create_entity` of the kind meant; the post's channels and module are the
/// founder's own plumbing (never words), put in here.
pub fn accept_entity(kind: &str, title: &str, channels: &[Value], role_module: &Value, blocks: &[Block]) -> Result<Vec<Value>, String> {
    let b = one(blocks)?;
    let Block::CreateEntity { kind: got, name, .. } = b else {
        return Err(format!("a draft that {}s where an organisation was to be founded", b.name().replace('_', " ")));
    };
    if got != kind {
        return Err(format!("an organisation of kind {got} where {kind} was meant"));
    }
    let name = name.trim();
    if name.is_empty() || name.chars().map(char::len_utf16).sum::<usize>() > 120 {
        return Err("no usable name".into());
    }
    Ok(vec![json!({ "block": "create_entity", "kind": kind, "name": name, "ref": "founded", "first_position": { "title": title, "channels": channels, "role_module": role_module } })])
}

/// A draft that says what the organisation is for: one public statement in its own name, nothing else on it. Marked as
/// put forward to be held (`assertion`), which is structure and not words.
pub fn accept_purpose(me: &str, blocks: &[Block]) -> Result<Vec<Value>, String> {
    let b = one(blocks)?;
    let Some(p) = publication(b) else { return Err("a draft that is no statement".into()) };
    if p.speaks_for.unwrap_or(me) != me {
        return Err("a statement in someone else's name".into());
    }
    if !p.public {
        return Err("a statement that is not public".into());
    }
    if p.offer.is_some() || p.practice.is_some() || p.addressed || p.text.trim().is_empty() {
        return Err("a statement carrying more than its words".into());
    }
    Ok(vec![json!({ "block": "publish", "kind": "purpose", "text": p.text, "visible_to": "public", "speaks_for": me, "assertion": { "that": slice16(p.text, 1_000) } })])
}

/// What a gathering's draft is held to.
#[derive(Debug, Clone, PartialEq)]
pub struct GatherBounds {
    pub at: String,
    pub every_days: Vec<i64>,
    pub lasts_minutes: Vec<i64>,
    /// The days (as moments) the first gathering may fall between.
    pub first: (i64, i64),
    pub at_seconds: i64,
}

/// A draft that puts up the gathering: one public notice with a practice, at the one place the group can use, with a
/// rhythm and a length among those open to it.
pub fn accept_gathering(me: &str, g: &GatherBounds, blocks: &[Block]) -> Result<Vec<Value>, String> {
    let b = one(blocks)?;
    let p = publication(b);
    let Some((p, pr)) = p.and_then(|p| p.practice.map(|pr| (p, pr))) else { return Err("a draft with no gathering in it".into()) };
    if p.speaks_for.unwrap_or(me) != me || !p.public {
        return Err("a notice that is not ours, or not public".into());
    }
    if p.offer.is_some() {
        return Err("a notice carrying an offer as well".into());
    }
    let at = pr.get("at").and_then(Value::as_str);
    if at != Some(g.at.as_str()) {
        return Err(format!("a gathering at {}, where we have no place", at.unwrap_or("undefined")));
    }
    let every = pr.get("every");
    if !among(&g.every_days, num(every), 86_400.0) {
        return Err(format!("a gathering every {} seconds, which is not among what was open", js(every)));
    }
    let lasts = pr.get("lasts").filter(|v| !v.is_null()).cloned().unwrap_or(json!(3_600));
    if !among(&g.lasts_minutes, num(Some(&lasts)), 60.0) {
        return Err(format!("a gathering of {} seconds, which is not among what was open", js(Some(&lasts))));
    }
    let first = pr.get("first").filter(|v| !v.is_null()).cloned().unwrap_or(json!(g.first.0));
    let f = num(Some(&first));
    if f.is_none_or(|f| f < g.first.0 as f64 || f > g.first.1 as f64) {
        return Err("a first gathering outside the days open to it".into());
    }
    let during = pr.get("during").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    let own_rules = pr.get("roles").and_then(Value::as_array).is_some_and(|rs| rs.iter().any(|r| r.get("who").and_then(Value::as_object).is_some_and(|w| !w.is_empty())));
    if during || own_rules {
        return Err("a gathering with rules of its own".into());
    }
    Ok(vec![json!({ "block": "publish", "kind": "notice", "text": p.text, "visible_to": "public", "speaks_for": me,
        "practice": { "at": g.at, "every": every, "first": first, "lasts": lasts, "roles": [{ "role": "member", "open": true }] } })])
}

/// What an offer of membership's draft is held to.
#[derive(Debug, Clone, PartialEq)]
pub struct MembershipBounds {
    pub account: Option<String>,
    pub dues: Vec<i64>,
    /// The notice a member may give, seconds.
    pub notice: i64,
}

/// A draft that offers membership: one public statement with an offer to join, whose only typed ask is dues among those
/// open, paid into the organisation's own account.
pub fn accept_membership(me: &str, o: &MembershipBounds, blocks: &[Block]) -> Result<Vec<Value>, String> {
    let b = one(blocks)?;
    let p = publication(b);
    let Some((p, offer)) = p.and_then(|p| p.offer.map(|of| (p, of))) else { return Err("a draft with no offer in it".into()) };
    if p.speaks_for.unwrap_or(me) != me || !p.public {
        return Err("an offer that is not ours, or not public".into());
    }
    if offer.get("take_up").and_then(Value::as_str) != Some("join") || offer.get("hears").is_some_and(|h| !falsy(h)) || p.practice.is_some() {
        return Err("an offer of something other than joining".into());
    }
    if offer.get("to").and_then(Value::as_object).is_some_and(|to| to.keys().any(|k| k != "anyone")) {
        return Err("an offer with conditions of its own".into());
    }
    let mut dues = 0.0;
    let none = vec![];
    for c in offer.pointer("/terms/commitments").and_then(Value::as_array).unwrap_or(&none) {
        let m = c.pointer("/does/outcome/money");
        let Some(m) = m.filter(|_| c.get("who").and_then(Value::as_str) == Some("taker")) else { continue };
        if m.get("to").and_then(Value::as_str) != o.account.as_deref() {
            return Err("dues paid to an account that is not ours".into());
        }
        if num(c.get("every")) != Some(30.0 * 86_400.0) {
            return Err("dues that are not monthly".into());
        }
        dues += match m.get("amount") {
            Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
            Some(v) => num(Some(v)).unwrap_or(f64::NAN),
            None => f64::NAN,
        };
    }
    if !o.dues.iter().any(|d| *d as f64 == dues) {
        return Err(format!("dues of {}, which are not among what was open", js(Some(&json!(dues)))));
    }
    Ok(vec![json!({ "block": "publish", "kind": "membership", "text": p.text, "visible_to": "public", "speaks_for": me,
        "offer": membership_offer(me, dues as i64, o.account.as_deref(), o.notice, None) })])
}

// ------------------------------------------------------------------------------- words through the translator

/// The question that sends one part of a founder's words to the translator (`words`): the plain request, as a seat's
/// would be (docs/behaviour/founding.md, "Through the translator"). The host drafts it as run.ts `wordsFor` does, and
/// answers with the draft (`blocks`, its `check`, its `provenance`), or `ok: false` and why. `attempt` 2: the first
/// draft was not what was meant and a trained translator wrote it, so the host's arrangement sends it behind.
pub fn words_question(about: &str, what: &str, idea: &str, text: &str, attempt: u8) -> crate::Question {
    let mut body = json!({ "what": what, "idea": idea, "text": text });
    if attempt > 1 {
        body["attempt"] = json!(attempt);
    }
    crate::Question { kind: "words".into(), about: about.to_string(), body }
}

/// What an answer to a `words` question came to, held to what the module says the draft may be.
#[derive(Debug, Clone, PartialEq)]
pub enum Came {
    /// What may be done: the accepted acts, to be sent as they are (their report goes with them).
    Accepted(crate::steps::Drafted),
    /// Not done: no draft, or not what was meant (reported now; the module's other way follows).
    NotDone(crate::Worded),
    /// Not what was meant, and to be put once more (reported now; ask again with attempt 2).
    Again(crate::Worded),
}

/// An answer to a `words` question (run.ts `wordsFor`, its half after the draft): a draft the kernel would refuse is not
/// what was meant; otherwise the module's `accept` says what it may be. `Null` (no translator to be had) is not done.
pub fn words_came(about: &str, what: &str, idea: &str, body: &Value, accept: impl FnOnce(&[Block]) -> Result<Vec<Value>, String>) -> Came {
    let s = |k: &str| body.get(k).and_then(Value::as_str).map(String::from);
    let mut w = crate::Worded { about: about.into(), what: what.into(), idea: Some(idea.to_string()).filter(|i| !i.is_empty()), draft: s("draft"), by: s("by"), ..Default::default() };
    if body.get("ok").and_then(Value::as_bool) != Some(true) {
        w.why = Some(s("why").unwrap_or_else(|| "The translator did not answer.".into()));
        return Came::NotDone(w);
    }
    w.draft_hash = s("draft_hash");
    let drafted = body.get("blocks").cloned().unwrap_or(json!([]));
    let blocks: Result<Vec<Block>, _> = serde_json::from_value(drafted.clone());
    let accepted = if body.pointer("/check/ok").and_then(Value::as_bool) == Some(false) {
        Err(format!("the acts would be refused ({})", body.pointer("/check/refusal").and_then(Value::as_str).unwrap_or("refused")))
    } else {
        match &blocks {
            Ok(b) => accept(b),
            Err(e) => Err(format!("a draft whose acts could not be read ({e})")),
        }
    }
    // (What it accepts is sent as blocks: each must read as one.)
    .and_then(|acc| match acc.iter().map(|b| serde_json::from_value::<Block>(b.clone())).collect::<Result<Vec<_>, _>>() {
        Ok(_) => Ok(acc),
        Err(e) => Err(format!("acts that could not be written ({e})")),
    });
    match accepted {
        Ok(acc) => {
            w.accepted = Some(true);
            w.plumbing_added = Value::Array(acc.clone()) != drafted;
            Came::Accepted(crate::steps::Drafted { blocks: acc, provenance: body.get("provenance").cloned().unwrap_or(Value::Null), worded: w })
        }
        Err(why) => {
            w.accepted = Some(false);
            w.why = Some(why);
            if body.get("again").and_then(Value::as_bool) == Some(true) {
                w.again = true;
                Came::Again(w)
            } else {
                Came::NotDone(w)
            }
        }
    }
}

/// The offer of membership as the contract's typed vocabulary has it (blocks: Offer): joining, with dues if any. `draws`:
/// what a fund pays a member who is short, cents.
pub fn membership_offer(me: &str, dues: i64, account: Option<&str>, notice: i64, draws: Option<i64>) -> Value {
    let mut commitments: Vec<Value> = vec![];
    if let (true, Some(account)) = (dues > 0, account.filter(|a| !a.is_empty())) {
        commitments.push(json!({ "who": "taker", "does": { "outcome": { "money": { "to": account, "amount": dues.to_string(), "for": "dues" } } }, "every": 30 * 86_400 }));
    }
    if let Some(d) = draws.filter(|d| *d > 0) {
        commitments.push(json!({ "who": me, "does": { "outcome": { "money": { "amount": d.to_string(), "for": "a draw on the fund, for a member who is short" } } } }));
    }
    commitments.push(json!({ "who": me, "does": { "text": "counts whoever joins among its members" } }));
    let mut offer = Map::new();
    offer.insert("by".into(), json!(me));
    offer.insert("take_up".into(), json!("join"));
    offer.insert("terms".into(), json!({ "template": "membership", "commitments": commitments, "termination": [{ "party": "taker", "notice": notice }] }));
    Value::Object(offer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_core::rng::Randomness;

    const DAY: i64 = 86_400;

    fn p() -> FoundingParams {
        FoundingParams { shapes: SHAPES.to_vec(), chance_bps: 400, ..Default::default() }
    }
    fn z0() -> Z {
        Z::default()
    }
    fn block(v: Value) -> Block {
        serde_json::from_value(v).unwrap_or_else(|e| panic!("block: {e}"))
    }
    fn pubb(x: Value) -> Block {
        let mut b = json!({ "block": "publish", "visible_to": "public" });
        b.as_object_mut().unwrap().extend(x.as_object().unwrap().clone());
        block(b)
    }

    #[test]
    fn the_dial_names_the_shapes_and_scales_the_chance_and_without_both_nobody_founds() {
        assert!(founding_params(&Value::Null, &json!({ "shapes": ["fund"] })).is_none());
        assert!(founding_params(&json!({ "chance_bps": 400 }), &Value::Null).is_none());
        let f = founding_params(&json!({ "chance_bps": 400, "dues": [0, 100] }), &json!({ "shapes": ["fund", "club"], "scale_bps": 20_000 })).unwrap();
        assert_eq!(f.shapes, vec![Shape::Fund]);
        assert_eq!(f.dues, vec![0, 100]);
        assert_eq!(chance_of(&f, &z0()), 800);
        assert_eq!(chance_of(&founding_params(&json!({ "chance_bps": 400 }), &json!({ "shapes": [] })).unwrap(), &z0()), 400);
        // Merged one level in: a given sway keeps the rest; a given row of odds replaces that row.
        let m = founding_params(&json!({ "sway": { "care": 0.9 }, "shape_odds": { "loss": { "fund": 5 } } }), &json!({})).unwrap();
        assert_eq!(m.sway.care, 0.9);
        assert_eq!(m.sway.agency, 0.3);
        assert_eq!(m.shape_odds["loss"].len(), 1);
        assert_eq!(m.shape_odds["meaning"].len(), 4);
    }

    #[test]
    fn whether_the_towns_chance_for_a_person_at_its_mean_swayed_symmetrically() {
        let p = p();
        assert_eq!(chance_of(&p, &z0()), 400);
        let up = chance_of(&p, &Z { agency: 1.0, ..z0() });
        let down = chance_of(&p, &Z { agency: -1.0, ..z0() });
        assert!(up > 400);
        assert_eq!(up - 400, 400 - down);
        assert_eq!(chance_of(&p, &Z { enterprise: -3.0, care: -3.0, agency: -3.0, standing: -3.0, ties: -3.0 }), 0);
        // A deviation beyond three counts as three.
        assert_eq!(chance_of(&p, &Z { agency: 9.0, ..z0() }), chance_of(&p, &Z { agency: 3.0, ..z0() }));
    }

    #[test]
    fn what_shape_by_the_want_the_values_and_who_it_is_against() {
        let p = p();
        let none = |_: &str| 0.0;
        let score = |o: &[Odds<Shape>], s: Shape| o.iter().find(|x| x.key == s).unwrap().score;
        let any = BTreeMap::new();
        let loss = shape_odds(&p, "loss", true, &none, &any);
        assert!(score(&loss, Shape::Gathering) > score(&loss, Shape::Fund));
        assert_eq!(score(&shape_odds(&p, "disrepair", false, &none, &any), Shape::Cause), 0);
        assert!(score(&shape_odds(&p, "disrepair", true, &none, &any), Shape::Cause) > 0);
        let unable = BTreeMap::from([(Shape::Business, false)]);
        assert_eq!(score(&shape_odds(&p, "let_go", true, &none, &unable), Shape::Business), 0);
        // Someone who values security leans to a fund; one who values novelty, away from it.
        let secure = shape_odds(&p, "let_go", true, &|v| if v == "security" { 2.0 } else { 0.0 }, &any);
        let restless = shape_odds(&p, "let_go", true, &|v| if v == "stimulation" { 2.0 } else { 0.0 }, &any);
        assert!(score(&secure, Shape::Fund) > score(&restless, Shape::Fund));
        // The draw is the stream's: the same stream, the same shape; nothing at all odds 0.
        let r = Randomness::new(7);
        assert_eq!(draw_of(&mut r.stream(&["a"]), &loss), draw_of(&mut r.stream(&["a"]), &loss));
        assert_eq!(draw_of(&mut r.stream(&["a"]), &[Odds { key: "x", score: 0 }]), None);
        // The whole of the odds is drawn from, in order: a 1 in 10 shape turns up in 1,000 draws.
        let mut seen = std::collections::BTreeSet::new();
        for i in 0..1000 {
            seen.insert(draw_of(&mut r.stream(&["d", &i.to_string()]), &loss).unwrap());
        }
        assert!(seen.contains(&Shape::Gathering) && seen.contains(&Shape::Fund) && !seen.contains(&Shape::Cause));
    }

    #[test]
    fn with_no_model_what_a_thing_is_for_is_the_founders_want_in_the_worlds_own_terms() {
        let w = |about: &str, whom: Option<&str>| WantOf { about: about.into(), whom: whom.map(String::from) };
        assert_eq!(
            plain_purpose(Shape::Cause, &w("disrepair", Some("landlord-3")), 4),
            "This is for those who know a home left in disrepair at the hands of landlord-3. 4 of us began it. We take up such matters with landlord-3 for our members, together."
        );
        assert!(plain_purpose(Shape::Gathering, &w("loss", None), 3).contains("the death of someone close"));
        assert!(!plain_purpose(Shape::Gathering, &w("loss", Some("x")), 3).contains("at the hands"));
        assert_eq!(plain_name(Shape::Fund, "c0001", &w("let_go", Some("shop-2"))), "Fund (let go, shop-2; c0001)");
        assert_eq!(matter_words("rent_increase"), "a rise in the rent");
        assert_eq!(matter_words("some_other_thing"), "some other thing");
    }

    #[test]
    fn a_dark_piece_is_one_by_the_stated_rule_and_no_other() {
        assert_eq!(dark_of("loss", &json!({}), 0.0), vec!["about:loss"]);
        assert!(dark_of("let_go", &json!({}), 0.0).is_empty());
        assert_eq!(
            dark_of("let_go", &json!({ "memory": { "defining": [{ "what": "ruined" }] }, "circumstances": { "housed": 0 } }), -1.2),
            vec!["lived:ruined", "homeless", "agency_low"]
        );
        assert!(dark_of("let_go", &json!({ "circumstances": { "housed": 1 } }), -0.99).is_empty());
    }

    #[test]
    fn a_draft_that_founds_one_organisation_of_the_kind_meant_with_the_founders_own_post() {
        let channels = [json!({ "id": "books" })];
        let module = json!({ "code": "group.founded" });
        let ok = accept_entity(
            "group",
            "Convenor",
            &channels,
            &module,
            &[block(json!({ "block": "create_entity", "kind": "group", "name": "The Tuesday Table", "first_position": { "title": "Boss", "role_module": { "code": "city.mayor_code" } } }))],
        )
        .unwrap();
        assert_eq!(
            ok[0],
            json!({ "block": "create_entity", "kind": "group", "name": "The Tuesday Table", "ref": "founded", "first_position": { "title": "Convenor", "channels": [{ "id": "books" }], "role_module": { "code": "group.founded" } } })
        );
        let kind = block(json!({ "block": "create_entity", "kind": "firm", "name": "X" }));
        assert!(accept_entity("group", "C", &channels, &module, &[kind]).is_err());
        assert!(accept_entity("group", "C", &channels, &module, &[block(json!({ "block": "transfer", "from": "a", "to": "b", "amount": "1" }))]).is_err());
        let one = block(json!({ "block": "create_entity", "kind": "group", "name": "A" }));
        assert!(accept_entity("group", "C", &channels, &module, &[one.clone(), one.clone()]).unwrap_err().contains("2 acts"));
        assert_eq!(accept_entity("group", "C", &channels, &module, &[block(json!({ "block": "create_entity", "kind": "group", "name": "  " }))]).unwrap_err(), "no usable name");
    }

    #[test]
    fn a_draft_of_the_statement_of_purpose_is_one_public_statement_of_ours_and_only_its_words() {
        let ok = accept_purpose("ent.1", &[pubb(json!({ "kind": "statement", "text": "We meet because nobody else will hear it." }))]).unwrap();
        assert_eq!(ok[0]["kind"], "purpose");
        assert_eq!(ok[0]["speaks_for"], "ent.1");
        assert_eq!(ok[0]["assertion"]["that"], "We meet because nobody else will hear it.");
        assert!(accept_purpose("ent.1", &[pubb(json!({ "kind": "purpose", "text": "x", "speaks_for": "ent.2" }))]).is_err());
        assert!(accept_purpose("ent.1", &[block(json!({ "block": "publish", "kind": "purpose", "text": "x", "visible_to": ["c0001"] }))]).is_err());
        assert!(accept_purpose("ent.1", &[pubb(json!({ "kind": "purpose", "text": "x", "offer": { "take_up": "join" } }))]).is_err());
        assert!(accept_purpose("ent.1", &[block(json!({ "block": "transfer", "from": "a", "to": "b", "amount": "1" }))]).is_err());
        // The assertion keeps the first thousand units of text, as JavaScript counts them.
        let long = "é".repeat(1_200);
        let cut = accept_purpose("ent.1", &[pubb(json!({ "kind": "purpose", "text": long }))]).unwrap();
        assert_eq!(cut[0]["assertion"]["that"].as_str().unwrap().chars().count(), 1_000);
        assert_eq!(slice16("a😀b", 2), "a");
        assert_eq!(slice16("a😀b", 3), "a😀");
    }

    fn bounds() -> GatherBounds {
        GatherBounds { at: "house-1/dwelling.1".into(), every_days: vec![7, 14], lasts_minutes: vec![60, 90], first: (10 * DAY, 40 * DAY), at_seconds: 19 * 3600 }
    }

    #[test]
    fn a_draft_of_the_gathering_is_at_the_one_place_we_can_use_with_a_rhythm_and_a_length_open() {
        let g = bounds();
        let notice = |practice: Value| pubb(json!({ "kind": "notice", "text": "We meet fortnightly.", "practice": practice }));
        let ok = accept_gathering("ent.1", &g, &[notice(json!({ "at": g.at, "every": 14 * DAY, "lasts": 5_400 }))]).unwrap();
        assert_eq!(ok[0]["practice"], json!({ "at": g.at, "every": 14 * DAY, "first": 10 * DAY, "lasts": 5_400, "roles": [{ "role": "member", "open": true }] }));
        for bad in [
            json!({ "at": "town-hall/hall.1", "every": 14 * DAY, "lasts": 5_400 }),
            json!({ "at": g.at, "every": 3 * DAY, "lasts": 5_400 }),
            json!({ "at": g.at, "every": 14 * DAY, "lasts": 8 * 3600 }),
            json!({ "at": g.at, "every": 14 * DAY, "lasts": 5_400, "roles": [{ "role": "member", "who": { "members_of": "union" } }] }),
            json!({ "at": g.at, "every": 14 * DAY, "lasts": 5_400, "first": 41 * DAY }),
        ] {
            assert!(accept_gathering("ent.1", &g, &[notice(bad.clone())]).is_err(), "{bad}");
        }
        assert!(accept_gathering("ent.1", &g, &[pubb(json!({ "kind": "notice", "text": "x" }))]).is_err());
        // The cell it is put up on is the translator's `on=`, not the practice's place: still the gathering we accept.
        let on = pubb(json!({ "kind": "notice", "text": "x", "place": "cell.4.7", "practice": { "at": g.at, "every": 14 * DAY, "lasts": 5_400 } }));
        assert!(accept_gathering("ent.1", &g, &[on]).is_ok());
    }

    #[test]
    fn a_draft_of_the_offer_of_membership_is_joining_with_dues_open_paid_into_our_own_account() {
        let b = MembershipBounds { account: Some("acc-9".into()), dues: vec![0, 500], notice: 7 * DAY };
        let dues = |to: &str, amount: &str, every: i64| json!({ "take_up": "join", "terms": { "commitments": [{ "who": "taker", "does": { "outcome": { "money": { "to": to, "amount": amount } } }, "every": every }] } });
        let ok = accept_membership("ent.1", &b, &[pubb(json!({ "kind": "notice", "text": "Five a month.", "offer": dues("acc-9", "500", 30 * DAY) }))]).unwrap();
        assert_eq!(ok[0]["kind"], "membership");
        assert_eq!(ok[0]["offer"], membership_offer("ent.1", 500, Some("acc-9"), 7 * DAY, None));
        let free = accept_membership("ent.1", &b, &[pubb(json!({ "kind": "notice", "text": "Free.", "offer": { "take_up": "join" } }))]).unwrap();
        assert_eq!(free[0]["offer"], membership_offer("ent.1", 0, Some("acc-9"), 7 * DAY, None));
        for bad in [
            dues("acc-other", "500", 30 * DAY),
            dues("acc-9", "50000", 30 * DAY),
            dues("acc-9", "500", 7 * DAY),
            json!({ "take_up": "apply", "hears": [{ "about": "debt" }] }),
            json!({ "take_up": "join", "to": { "members_of": "union" } }),
        ] {
            assert!(accept_membership("ent.1", &b, &[pubb(json!({ "kind": "notice", "text": "x", "offer": bad.clone() }))]).is_err(), "{bad}");
        }
        assert!(accept_membership("ent.1", &b, &[pubb(json!({ "kind": "notice", "text": "x" }))]).unwrap_err().contains("no offer"));
    }

    #[test]
    fn the_offer_of_membership_states_dues_a_fund_draw_and_the_one_thing_the_group_does() {
        let o = membership_offer("g", 1_000, Some("acc"), 7 * DAY, Some(6_000));
        let c = o["terms"]["commitments"].as_array().unwrap();
        assert_eq!(c.len(), 3);
        assert_eq!(c[0]["does"]["outcome"]["money"]["amount"], "1000");
        assert_eq!(c[0]["every"], 30 * DAY);
        assert_eq!(c[1]["does"]["outcome"]["money"]["amount"], "6000");
        assert_eq!(c[2]["does"]["text"], "counts whoever joins among its members");
        assert_eq!(o["terms"]["termination"], json!([{ "party": "taker", "notice": 7 * DAY }]));
        assert_eq!(membership_offer("g", 0, None, 1, None)["terms"]["commitments"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn params_saved_and_restored_are_the_same() {
        let f = p();
        let back: FoundingParams = serde_json::from_value(serde_json::to_value(&f).unwrap()).unwrap();
        assert_eq!(f, back);
        assert_eq!(chance_of(&back, &z0()), chance_of(&f, &z0()));
    }
}
