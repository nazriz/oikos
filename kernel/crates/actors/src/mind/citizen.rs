//! citizen.ts's deciding half (lane A2): the mind behind the seam (`crate::citizen::mind::Mind`).
//!
//! citizen.ts was one closure in which a person's life and mind shared local state. Here the mind is one struct,
//! `CitizenMind`: who the person is (`person::Mind`), their record (`inner::Inner`), feelings and ties, wants,
//! culture and what they remember of the town, belief, goals, the gatherings they go to, what they founded and belong
//! to, civic life, petitions, talk; and its parameters, read from the same `ctx.params` life reads (the citizen's
//! params, citizen.ts's defaults). Life calls it through the seam and never reads its insides; it reads nothing of
//! life's but `Life`, the book and the picture.
//!
//! What it records: the `decision` and `outcome` annotations (`cx.decided`, `cx.learned`), exactly as citizen.ts
//! wrote them, and the person's own record (`cx.set_record`). Questions to models (`consult`, `compose`, `reading`,
//! `words`) go out with `cx.ask` and come back in `cx.answers` at the next wake (`woke`).
//!
//! Decided fresh (port guide 2): JavaScript's `Math.round` is `math::round`; maps TS iterated in insertion order where
//! the order reaches an outcome are kept as `Vec`s in that order (the contacts kept, origins heard); everything else
//! is a `BTreeMap`. Floats appear only inside a computation (z-scores, the sways) and are rounded before they are
//! stored, compared or drawn on.

use super::culture::{self, Conduct, Culture, CultureDial, Standing};
use super::founding::{self, FoundingParams};
use super::inner::{self, Bond, Experienced, Happening, Inner, Moved};
use super::math::round;
use super::person::{self, Emotion, Feelings, Need, Needs, Pursuit, Ties, Value};
use super::reading::{self, PaperRead, ReadingDial};
use super::talk::News;
use super::townmemory::TownMemory;
use super::wants::{self, Want, Wants};
use crate::citizen::mind::*;
use crate::common::Book;
use crate::{Answer, Ctx, Cx, Question, DAY};
pub use super::plan::kind_of_way;
use oikos_sight::{Picture, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};
use std::collections::{BTreeMap, BTreeSet};

pub const MONTH: i64 = 30 * DAY;
const MONEY_MATTERS: [&str; 3] = ["shop", "job", "home"];
/// The least a fund's draw must cover of a month's essentials to answer having nothing to fall back on (citizen.ts
/// `FUND_WORTH_MIN`, a tenth, in basis points).
pub const FUND_WORTH_MIN_BPS: i64 = 1_000;

// ------------------------------------------------------------------ parameters

/// citizen.ts's `GOALS`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Goals {
    pub unmet_days: i64,
    pub method_days: i64,
    pub rest_days: i64,
    pub security_bps: i64,
    pub social_bps: i64,
    pub spend_less_saving_bps: i64,
    pub cheaper_bps: i64,
}
impl Default for Goals {
    fn default() -> Self {
        Goals { unmet_days: 60, method_days: 90, rest_days: 180, security_bps: 3_000, social_bps: 4_000, spend_less_saving_bps: 2_000, cheaper_bps: 9_000 }
    }
}

/// citizen.ts's `BELIEF` (`meaning` in thousandths: TS 0.2 is 200).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BeliefP {
    pub fade_bps: i64,
    pub display_bps: i64,
    pub told_bps: i64,
    pub tell_at_bps: i64,
    pub affiliate_bps: i64,
    pub meaning: f64,
}
impl Default for BeliefP {
    fn default() -> Self {
        BeliefP { fade_bps: 300, display_bps: 500, told_bps: 300, tell_at_bps: 6_000, affiliate_bps: 3_000, meaning: 0.2 }
    }
}

/// citizen.ts's `SWAY` (fractions of a rate per standard deviation, as TS wrote them).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Sway {
    pub consult: f64,
    pub union_belief: f64,
    pub union_peers: f64,
    pub union_join: f64,
    pub turnout: f64,
    pub strike_vote: f64,
    pub patience_tradition: f64,
    pub patience_security: f64,
    pub enterprise_openness: f64,
    pub enterprise_achievement: f64,
}
impl Default for Sway {
    fn default() -> Self {
        Sway {
            consult: 1.0,
            union_belief: 0.5,
            union_peers: 0.5,
            union_join: 0.3,
            turnout: 0.15,
            strike_vote: 0.08,
            patience_tradition: 0.2,
            patience_security: 0.1,
            enterprise_openness: 0.4,
            enterprise_achievement: 0.3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Civic {
    pub turnout_bps: i64,
    pub stand_bps: i64,
    pub reads_news_bps: i64,
    pub approval_memory_weeks: i64,
    pub news_weight_bps: i64,
    pub platform_weight_bps: i64,
}
impl Default for Civic {
    fn default() -> Self {
        Civic { turnout_bps: 9_000, stand_bps: 30, reads_news_bps: 5_000, approval_memory_weeks: 26, news_weight_bps: 1_500, platform_weight_bps: 2_500 }
    }
}

/// What a tenants' petition asks for, where the world's profile says (decided fresh, risks PC-8: citizen.ts wrote one
/// place's figures, 90 days' notice and rises of at most 5% a year, into every town's petition). Absent: the petition
/// asks in words for longer notice and limits on rises, with no figures of anywhere, and proposes no amendment.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PetitionDemand {
    pub notice_days: Option<i64>,
    pub rise_cap_bps: Option<i64>,
}

/// The parameters the mind reads: citizen.ts's, as the world gives them over its defaults (the names and meanings
/// unchanged). Rebuilt from `ctx.params` at `make` and `restore`, never saved.
#[derive(Debug, Clone)]
pub struct P {
    pub me: String,
    pub participant: String,
    pub year: i64,
    pub essentials: i64,
    pub essentials_units: i64,
    pub goods: String,
    pub in_labour_force: bool,
    pub values: person::PopulationValues,
    pub own_values: Option<BTreeMap<String, i64>>,
    pub outlook: inner::Outlook,
    pub outlook_json: Json,
    pub institutions: BTreeMap<String, String>,
    pub bank: Option<String>,
    pub union: Option<String>,
    pub complain_to: Option<String>,
    pub electoral_town: Option<String>,
    pub electoral_body: Option<String>,
    pub paper: Option<String>,
    pub tribunal: Option<String>,
    pub police: Option<String>,
    pub care: Option<String>,
    pub school_entity: Option<String>,
    pub school_building: Option<String>,
    pub care_waiting: Option<String>,
    pub union_join_bps: BTreeMap<String, i64>,
    pub ballot_turnout_bps: i64,
    pub strike_vote_yes_bps: i64,
    pub max_contacts: usize,
    pub catch_up_days: i64,
    pub news_days: i64,
    pub ask_home_bps: i64,
    pub ask_work_bps: i64,
    pub ask_again_days: i64,
    pub pass_on_bps: i64,
    pub beliefs: BTreeMap<String, i64>,
    pub belief: BeliefP,
    pub sway: Sway,
    pub goals: Goals,
    pub civic: Civic,
    pub petition_start_bps: i64,
    pub petition_willing_bps: i64,
    pub petition_days: i64,
    pub petition: PetitionDemand,
    pub tenancy_schedule: String,
    pub threshold_mean_bps: i64,
    pub threshold_sd_bps: i64,
    pub population: i64,
    pub rent_burden_grievance_bps: i64,
    pub aggrieved_bps: i64,
    pub attach_mean_place: Option<i64>,
    pub attach_mean_trade: Option<i64>,
    pub started: Option<Json>,
    pub ventures_any: bool,
    pub can_found_business: bool,
    pub origin: Option<String>,
    pub initiative: Option<bool>,
    pub mind: person::MindParams,
    pub inner: inner::InnerParams,
    pub wants: wants::WantParams,
    pub founding: Option<FoundingParams>,
    pub cdial: Option<CultureDial>,
    pub rdial: Option<ReadingDial>,
    /// The culture's rates for the conducts a person's acts are drawn at (citizen.ts 839-853).
    pub conduct_rates: BTreeMap<Conduct, i64>,
    pub consult: bool,
    pub compose: bool,
    pub tick: i64,
}

fn s(v: &Json, k: &str) -> Option<String> {
    v.get(k).and_then(Json::as_str).filter(|x| !x.is_empty()).map(String::from)
}
fn i(v: &Json, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| round(f))))
}
fn of<T: serde::de::DeserializeOwned + Default>(v: &Json, k: &str) -> T {
    match v.get(k) {
        Some(x) if !x.is_null() => serde_json::from_value(x.clone()).unwrap_or_default(),
        _ => T::default(),
    }
}

impl P {
    pub fn of(ctx: &Ctx) -> P {
        let v = Json::Object(ctx.params.clone());
        let dials = &ctx.world.dials;
        let nested = |k: &str, sub: &str| v.get(k).and_then(|x| s(x, sub));
        let union_join_bps: BTreeMap<String, i64> = of(&v, "union_join_bps");
        let union = s(&v, "union");
        let possession = v.get("possession").filter(|x| !x.is_null());
        let cdial = culture::culture_dial(dials).ok().flatten();
        let mut conduct_rates = BTreeMap::new();
        if let Some(cd) = &cdial {
            if let Some(a) = possession.and_then(|x| i(x, "answer_bps")) {
                conduct_rates.insert(Conduct::AnswerTribunal, a);
            }
            if let Some(x) = possession.and_then(|x| i(x, "stay_bps")) {
                conduct_rates.insert(Conduct::StayPastNotice, x);
            }
            if let Some(x) = v.get("tribunal").and_then(|x| i(x, "challenge_bps")) {
                conduct_rates.insert(Conduct::TakeToTribunal, x);
            }
            if s(&v, "complain_to").is_some() {
                conduct_rates.insert(Conduct::Complain, i(&v, "complain_bps").unwrap_or(3_000));
            }
            conduct_rates.insert(Conduct::TakeIn, cd.params.does_default_bps);
            if union.is_some() && !union_join_bps.is_empty() {
                let sum: i64 = union_join_bps.values().sum();
                conduct_rates.insert(Conduct::JoinUnion, round(sum as f64 / union_join_bps.len() as f64));
            }
            if union.is_some() {
                conduct_rates.insert(Conduct::Strike, i(&v, "strike_vote_yes_bps").unwrap_or(8_500));
            }
            if let Some(c) = v.get("crime").filter(|x| !x.is_null()) {
                let (take, caught) = (i(c, "take_bps").unwrap_or(0), i(c, "caught_bps").unwrap_or(0));
                conduct_rates.insert(Conduct::TakeFromEmployer, round((take * (10_000 - caught)) as f64 / 10_000.0));
            }
            if possession.is_some() {
                conduct_rates.insert(Conduct::ApplyPossession, cd.params.does_default_bps);
            }
        }
        let ventures: Vec<Json> = of(&v, "ventures");
        let found_bps = i(&v, "found_bps").unwrap_or(0);
        let found_own_ppm = i(&v, "found_own_ppm").unwrap_or(0);
        P {
            me: ctx.entity.clone(),
            participant: ctx.participant.clone(),
            year: i(&v, "year").unwrap_or(365 * DAY),
            essentials: i(&v, "essentials").unwrap_or(40_000),
            essentials_units: i(&v, "essentials_units").unwrap_or(10),
            goods: s(&v, "goods").unwrap_or_else(|| "goods".into()),
            in_labour_force: v.get("in_labour_force").and_then(Json::as_bool).unwrap_or(true),
            values: of(&v, "values"),
            own_values: v.get("own_values").filter(|x| !x.is_null()).and_then(|x| serde_json::from_value(x.clone()).ok()),
            outlook: of(&v, "outlook"),
            outlook_json: v.get("outlook").cloned().unwrap_or(json!({})),
            institutions: of(&v, "institutions"),
            bank: s(&v, "bank"),
            union,
            complain_to: s(&v, "complain_to"),
            electoral_town: s(&v, "electoral_town"),
            electoral_body: s(&v, "electoral_body"),
            paper: s(&v, "paper"),
            tribunal: nested("tribunal", "entity"),
            police: nested("welfare", "police"),
            care: nested("care", "entity"),
            school_entity: nested("school", "entity"),
            school_building: nested("school", "building"),
            care_waiting: nested("care", "waiting"),
            union_join_bps,
            ballot_turnout_bps: i(&v, "ballot_turnout_bps").unwrap_or(7_000),
            strike_vote_yes_bps: i(&v, "strike_vote_yes_bps").unwrap_or(8_500),
            max_contacts: i(&v, "max_contacts").unwrap_or(15).max(0) as usize,
            catch_up_days: i(&v, "catch_up_days").unwrap_or(14).max(1),
            news_days: i(&v, "news_days").unwrap_or(90),
            ask_home_bps: i(&v, "ask_home_bps").unwrap_or(3_700),
            ask_work_bps: i(&v, "ask_work_bps").unwrap_or(6_900),
            ask_again_days: i(&v, "ask_again_days").unwrap_or(60),
            pass_on_bps: i(&v, "pass_on_bps").unwrap_or(10_000),
            beliefs: of(&v, "beliefs"),
            belief: merged(&v, "belief"),
            sway: merged(&v, "sway"),
            goals: merged(&v, "goals"),
            civic: merged(&v, "civic"),
            petition_start_bps: i(&v, "petition_start_bps").unwrap_or(300),
            petition_willing_bps: i(&v, "petition_willing_bps").unwrap_or(4_400),
            petition_days: i(&v, "petition_days").unwrap_or(180),
            petition: of(&v, "petition_demand"),
            tenancy_schedule: s(&v, "tenancy_schedule").unwrap_or_default(),
            threshold_mean_bps: i(&v, "threshold_mean_bps").unwrap_or(2_500),
            threshold_sd_bps: i(&v, "threshold_sd_bps").unwrap_or(1_000),
            population: i(&v, "population").unwrap_or(200).max(1),
            rent_burden_grievance_bps: i(&v, "rent_burden_grievance_bps").unwrap_or(4_000),
            aggrieved_bps: i(&v, "aggrieved_bps").unwrap_or(2_000),
            attach_mean_place: v.get("attach_mean").and_then(|x| i(x, "place_bps")),
            attach_mean_trade: v.get("attach_mean").and_then(|x| i(x, "trade_bps")),
            started: v.get("started").filter(|x| !x.is_null()).cloned(),
            ventures_any: !ventures.is_empty(),
            can_found_business: !ventures.is_empty()
                && (found_bps > 0 || found_own_ppm > 0 || ventures.iter().any(|x| x.get("own").and_then(Json::as_bool) == Some(true))),
            origin: s(&v, "origin"),
            initiative: v.get("initiative").and_then(Json::as_bool),
            mind: person::mind_params(v.get("mind").unwrap_or(&Json::Null)),
            inner: inner::inner_params(v.get("inner").unwrap_or(&Json::Null)),
            wants: wants::want_params(v.get("wants").unwrap_or(&Json::Null)),
            founding: None,
            cdial,
            rdial: reading::reading_dial(&json!({ "dials": dials })).ok().flatten(),
            conduct_rates,
            consult: dials.get("consult").map_or(false, |x| !x.is_null() && x != &Json::Bool(false)) || ctx.params.get("consult").and_then(Json::as_bool) == Some(true),
            // (The world's composer dial is `composer`, as the generator writes it and run.ts reads it; the port read
            // `compose`, so a Rust world never asked for a piece.)
            compose: dials.get("composer").map_or(false, |x| !x.is_null() && x != &Json::Bool(false)) || ctx.params.get("compose").and_then(Json::as_bool) == Some(true),
            tick: ctx.world.tick.max(1),
        }
    }
}

/// A section of params merged over its defaults (citizen.ts `{ ...SWAY, ...(ctx.params.sway ?? {}) }`).
fn merged<T: Serialize + serde::de::DeserializeOwned + Default>(v: &Json, k: &str) -> T {
    let mut base = serde_json::to_value(T::default()).unwrap_or(json!({}));
    if let (Some(Json::Object(given)), Json::Object(b)) = (v.get(k), &mut base) {
        for (key, x) in given {
            b.insert(key.clone(), x.clone());
        }
    }
    serde_json::from_value(base).unwrap_or_default()
}

// ------------------------------------------------------------------ memory

/// A gathering they are at (citizen.ts `attending`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attending {
    pub practice: String,
    pub host: String,
    pub space: String,
    pub until: i64,
    pub gone: bool,
    pub seen: Option<Vec<String>>,
}

/// A run-made group they belong to (citizen.ts `groups`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub t: i64,
    pub agreement: String,
    pub went: i64,
    pub claimed: Option<i64>,
    pub drew: Option<i64>,
}

/// What they have begun to found and are finding words for (citizen.ts `Begun`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Begun {
    pub want: Want,
    pub shape: String,
    pub sharers: Vec<(String, String)>,
    pub brief: Json,
    pub dues: Vec<i64>,
    /// The composer's piece: absent, not yet answered; `Null`, none to be had (or declined).
    pub piece: Option<Json>,
    pub sent: bool,
    pub name_by: Option<String>,
    /// The words asked of the translator for the name, awaiting the answer.
    pub naming: bool,
}

/// What a child is told on coming of age (citizen.ts `upbringing`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Upbringing {
    pub settled: bool,
    pub asked_at: Option<i64>,
    pub told: Vec<(Vec<String>, Vec<String>)>,
    pub culture: Vec<(Vec<culture::HouseholdRow>, Option<String>)>,
}

/// Everything the mind remembers (snapshot and fork: `save` writes it, `restore` reads it back to the bit).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub mind: person::Mind,
    pub inner: Inner,
    pub feelings: Feelings,
    pub ties: Ties,
    pub wants: Wants,
    pub initiative: bool,
    pub culture: Option<Culture>,
    pub town: Option<TownMemory>,
    pub beliefs: BTreeMap<String, i64>,
    pub faded_at: Option<i64>,
    pub levels: Needs,
    pub decisions: u64,
    pub chose: BTreeMap<String, u64>,
    pub person_told: bool,
    pub pursuits: BTreeMap<String, Pursuit>,
    pub unmet_since: BTreeMap<String, i64>,
    pub rest_until: BTreeMap<String, i64>,
    pub short_since: BTreeMap<String, i64>,
    pub employers: BTreeSet<String>,
    pub let_go: Option<(String, i64)>,
    pub noticed_by: Option<(String, i64)>,
    pub withdrew: Option<(String, i64)>,
    pub trouble_to_tell: Vec<(String, String)>,
    pub refused_by: BTreeSet<String>,
    pub heard_wronged: BTreeMap<String, (String, String, i64)>,
    pub mourners: BTreeMap<String, BTreeSet<String>>,
    pub recourse_bump: BTreeMap<String, i64>,
    pub last_seen: i64,
    // talk
    pub told_us: BTreeMap<String, (News, i64)>,
    pub talked: BTreeMap<String, i64>,
    /// People we have come to know by talking with them, mourning with them or meeting them at a gathering (TS's
    /// `peopleWeKnow`, kept at the same places): those asked whether we may stay when we have no home.
    #[serde(default)]
    pub people_known: BTreeSet<String>,
    /// The people we know from homes and workplaces shared, with when, in the order TS's Map kept them.
    pub contacts: Vec<(String, i64)>,
    pub asked_how: Vec<String>,
    pub asked: Vec<(String, String)>,
    pub asked_at: BTreeMap<String, i64>,
    pub verdicts: Vec<(String, String)>,
    pub origin_seen: Vec<(String, String)>,
    pub next_catch_up: Option<i64>,
    pub asked_what_matters: Vec<String>,
    pub upbringing: Upbringing,
    pub read_news: BTreeSet<String>,
    pub counted_ballots: BTreeSet<String>,
    // gatherings
    pub attending: Option<Attending>,
    /// How long it took us to get to a place last time we set off for it (space -> seconds), and the trip under way.
    #[serde(default)]
    pub way_to: BTreeMap<String, i64>,
    #[serde(default)]
    pub setting_off: Option<(String, i64)>,
    pub going: BTreeMap<String, i64>,
    pub decided_for: BTreeMap<String, i64>,
    pub company_at: BTreeMap<String, i64>,
    pub went_last: BTreeSet<String>,
    pub stayed_last: BTreeSet<String>,
    pub practice_wake: Option<i64>,
    pub knows_practices: bool,
    // founding and groups
    pub found_rest: i64,
    pub begun: Option<Begun>,
    pub pending_group: bool,
    pub my_group: Option<(String, String, String)>,
    pub join_group: BTreeSet<String>,
    pub applied_to: BTreeSet<String>,
    pub groups: BTreeMap<String, Group>,
    // union
    pub join_asked: String,
    pub join_now: bool,
    // civic
    pub enrolled: Option<bool>,
    pub approval: i64,
    pub approved_at: i64,
    pub voted: BTreeSet<String>,
    pub stood_for: BTreeSet<String>,
    pub reads_news: bool,
    pub read_items: BTreeSet<String>,
    // voice
    pub threshold: i64,
    pub willing: bool,
    pub signed: BTreeSet<String>,
    pub counts_published: BTreeMap<String, (i64, i64)>,
    pub petition_seen: BTreeSet<String>,
    /// The petitions board as the last look showed it.
    pub petitions_found: Vec<std::sync::Arc<oikos_sight::Record>>,
    pub sign_now: BTreeSet<String>,
    pub stand_now: BTreeSet<String>,
    pub notice_seen: BTreeSet<String>,
    /// Tenancies whose notice lapsed or was answered (we stay): a want about the notice is met.
    pub notice_over: BTreeSet<String>,
    /// What has been paid us against a debt owed us (claim -> cents), as life reports it.
    pub settled_to_us: BTreeMap<String, i64>,
    /// Our home is complained of, until it is seen to (life's `complainedOf`, as it tells us).
    pub complained: bool,
    pub discouraged_until: i64,
    pub pending_intents: Vec<Intent>,
    // the sparse mind
    pub consulted: BTreeMap<String, Option<Json>>,
    pub awaiting: BTreeSet<String>,
    /// Readings of papers come back from the reader (paper -> its reading), and those asked for.
    pub readings: BTreeMap<String, Option<PaperRead>>,
    /// What the last `treated` with a paper's words moved, to go on the outcome that follows it.
    pub last_read: Option<(String, Json)>,
    pub teachings: BTreeMap<String, Vec<String>>,
    /// Practices in the book, by id, and who holds them.
    pub practice_hosts: BTreeMap<String, String>,
    // the record
    pub written: BTreeMap<String, Json>,
    pub hours_at: i64,
    pub norms_version: u64,
    pub heard_version: u64,
    pub planned_once: bool,
    /// Records from this moment on are fresh to the next plan.
    pub last_planned_from: i64,
}

/// The mind of a citizen.
pub struct CitizenMind {
    pub p: P,
    pub s: State,
    /// For one `treated` only: the outcome its paper's reading goes on is recorded after it (and names the paper), not
    /// before. Never saved: set and cleared within one call.
    pub read_follows: bool,
}

// ------------------------------------------------------------------ making one

pub fn make(cx: &mut Cx, born: &Born) -> Result<Box<dyn Mind>, String> {
    let p = P::of(cx.ctx);
    let own: Option<person::Values> = born
        .own_values
        .and_then(|v| serde_json::from_value::<BTreeMap<String, i64>>(v.clone()).ok())
        .or_else(|| p.own_values.clone())
        .map(|m| Value::ALL.map(|v| m.get(v.name()).copied().unwrap_or(5_000)));
    let expect: BTreeMap<String, i64> = [("shop", 8_000), ("job", 5_000), ("practice", 4_000)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    let mind = person::Mind::new(&mut cx.rng("person"), &p.values, p.mind, expect, own);
    let inner = Inner::new(&mut cx.rng("inner"), &mind.person.values, &p.values, &p.outlook, p.inner.clone());
    let dial = cx.ctx.world.dials.get("initiative_bps").and_then(Json::as_i64).unwrap_or(0);
    let initiative = p.initiative.unwrap_or_else(|| dial > 0 && (cx.rng("initiative").below(10_000) as i64) < dial);
    let wants = Wants::new(p.wants.clone());
    let people = p.outlook.people_bps.unwrap_or(5_000);
    let mut m = CitizenMind {
        s: State::new(mind, inner, wants, initiative, Ties::new(180, p.max_contacts + 3, people), &p, born.own_values.is_some()),
        p,
        read_follows: false,
    };
    // (citizen.ts's order of draws: person, inner, initiative; culture's own; then threshold, petition-willing, reads-news.)
    if let Some(cd) = m.p.cdial.clone() {
        let env = m.env();
        let t = cx.t;
        let mut draw = |c: Conduct| culture::standard_normal(&mut cx.rng(&format!("culture-own-{}", c.name())));
        m.s.culture = Some(Culture::new(cd.params.clone(), &cd, &env, &mut draw, &m.p.conduct_rates, m.p.origin.as_deref(), t));
        m.s.town = Some(TownMemory::new(cd.params.clone()));
    }
    m.s.threshold = {
        let mut tr = cx.rng("threshold");
        let mut z = -6 * 10_000i64;
        for _ in 0..12 {
            z += tr.below(10_000) as i64;
        }
        let zc = ((m.conformity() - 5_000) as f64 / 1_060.0).clamp(-3.0, 3.0);
        let zt = 0.5 * zc + 0.866 * (z as f64 / 10_000.0);
        (m.p.threshold_mean_bps + (zt * m.p.threshold_sd_bps as f64).trunc() as i64).max(0)
    };
    m.s.willing = (cx.rng("petition-willing").below(10_000) as i64) < m.p.petition_willing_bps;
    m.s.reads_news = (cx.rng("reads-news").below(10_000) as i64) < m.p.civic.reads_news_bps;
    m.p.founding = founding_of(cx.ctx, m.s.initiative);
    Ok(Box::new(m))
}

fn founding_of(ctx: &Ctx, initiative: bool) -> Option<FoundingParams> {
    if !initiative {
        return None;
    }
    founding::founding_params(ctx.params.get("founding").unwrap_or(&Json::Null), ctx.world.dials.get("founding").unwrap_or(&Json::Null))
}

pub fn restore(ctx: &Ctx, saved: Json) -> Result<Box<dyn Mind>, String> {
    let s: State = serde_json::from_value(saved).map_err(|e| format!("the citizen's mind: {e}"))?;
    let mut p = P::of(ctx);
    p.founding = founding_of(ctx, s.initiative);
    Ok(Box::new(CitizenMind { p, s, read_follows: false }))
}

impl State {
    fn new(mind: person::Mind, inner: Inner, wants: Wants, initiative: bool, ties: Ties, p: &P, born_own: bool) -> State {
        State {
            mind,
            inner,
            feelings: Feelings::default(),
            ties,
            wants,
            initiative,
            culture: None,
            town: None,
            beliefs: p.beliefs.clone(),
            faded_at: None,
            levels: [10_000; 7],
            decisions: 0,
            chose: BTreeMap::new(),
            person_told: false,
            pursuits: BTreeMap::new(),
            unmet_since: BTreeMap::new(),
            rest_until: BTreeMap::new(),
            short_since: BTreeMap::new(),
            employers: BTreeSet::new(),
            let_go: None,
            noticed_by: None,
            withdrew: None,
            trouble_to_tell: vec![],
            refused_by: BTreeSet::new(),
            heard_wronged: BTreeMap::new(),
            mourners: BTreeMap::new(),
            recourse_bump: BTreeMap::new(),
            last_seen: 0,
            told_us: BTreeMap::new(),
            talked: BTreeMap::new(),
            people_known: BTreeSet::new(),
            contacts: vec![],
            asked_how: vec![],
            asked: vec![],
            asked_at: BTreeMap::new(),
            verdicts: vec![],
            origin_seen: vec![],
            next_catch_up: None,
            asked_what_matters: vec![],
            upbringing: Upbringing { settled: born_own || p.own_values.is_some(), ..Default::default() },
            read_news: BTreeSet::new(),
            counted_ballots: BTreeSet::new(),
            attending: None,
            way_to: BTreeMap::new(),
            setting_off: None,
            going: BTreeMap::new(),
            decided_for: BTreeMap::new(),
            company_at: BTreeMap::new(),
            went_last: BTreeSet::new(),
            stayed_last: BTreeSet::new(),
            practice_wake: None,
            knows_practices: false,
            found_rest: 0,
            begun: None,
            pending_group: false,
            my_group: None,
            join_group: BTreeSet::new(),
            applied_to: BTreeSet::new(),
            groups: BTreeMap::new(),
            join_asked: String::new(),
            join_now: false,
            enrolled: None,
            approval: 0,
            approved_at: -1,
            voted: BTreeSet::new(),
            stood_for: BTreeSet::new(),
            reads_news: false,
            read_items: BTreeSet::new(),
            threshold: 0,
            willing: false,
            signed: BTreeSet::new(),
            counts_published: BTreeMap::new(),
            petition_seen: BTreeSet::new(),
            petitions_found: vec![],
            sign_now: BTreeSet::new(),
            stand_now: BTreeSet::new(),
            notice_seen: BTreeSet::new(),
            notice_over: BTreeSet::new(),
            settled_to_us: BTreeMap::new(),
            complained: false,
            discouraged_until: 0,
            pending_intents: vec![],
            consulted: BTreeMap::new(),
            awaiting: BTreeSet::new(),
            readings: BTreeMap::new(),
            last_read: None,
            teachings: BTreeMap::new(),
            practice_hosts: BTreeMap::new(),
            written: BTreeMap::new(),
            hours_at: 0,
            norms_version: u64::MAX,
            heard_version: u64::MAX,
            planned_once: false,
            last_planned_from: i64::MIN,
        }
    }
}

// ------------------------------------------------------------------ small rules

impl CitizenMind {
    pub fn me(&self) -> &str {
        &self.p.me
    }
    pub fn vals(&self) -> &person::Values {
        &self.s.mind.person.values
    }
    /// What kind of institution someone is to us (citizen.ts `kindOf`).
    pub fn kind_of(&self, who: &str) -> String {
        let p = &self.p;
        if let Some(k) = p.institutions.get(who) {
            return k.clone();
        }
        let is = |x: &Option<String>| x.as_deref() == Some(who);
        if is(&p.bank) {
            "banks"
        } else if is(&p.union) {
            "unions"
        } else if is(&p.complain_to) || is(&p.electoral_town) {
            "government"
        } else if is(&p.tribunal) {
            "courts"
        } else if is(&p.police) {
            "policing"
        } else if is(&p.paper) {
            "press"
        } else if is(&p.care) || is(&p.school_entity) {
            "civil_service"
        } else if self.s.employers.contains(who) {
            "companies"
        } else {
            "other"
        }
        .to_string()
    }
    /// How far a value sits from the world's (standard deviations, -3..3: citizen.ts `zValue`).
    pub fn z_value(&self, v: Value) -> f64 {
        let d = self.p.values.of(v);
        ((self.s.mind.person.values[v.index()] - d.mean_bps) as f64 / d.sd_bps.max(1) as f64).clamp(-3.0, 3.0)
    }
    pub fn conformity(&self) -> i64 {
        self.s.mind.person.temperament.conformity
    }
    /// citizen.ts `shifted`.
    pub fn shifted(bps: i64, shift: f64) -> i64 {
        round(bps as f64 * (1.0 + shift)).clamp(0, 10_000)
    }
    /// Trust in someone against the town's figure for its kind, standard deviations (inner.ts `zTrust`: reading it
    /// starts the entry, as TS did).
    pub fn zt(&mut self, who: &str, t: i64) -> f64 {
        let k = self.kind_of(who);
        self.s.inner.z_trust(&self.s.mind.person.values, who, &k, t) as f64 / 100.0
    }
    /// The sense of agency against the town's mean, standard deviations.
    pub fn za(&self) -> f64 {
        self.s.inner.z_agency() as f64 / 100.0
    }
    pub fn trust_in(&mut self, who: &str, kind: &str, t: i64) -> i64 {
        self.s.inner.trust_in(&self.s.mind.person.values, who, kind, t)
    }
    /// inner.ts `experience`, with the kind as we know them.
    pub fn exp(&mut self, who: &str, good: bool, t: i64, weight_bps: i64, heard: bool, scale_bps: Option<i64>) -> Moved {
        let k = self.kind_of(who);
        self.exp_k(who, &k, good, t, weight_bps, heard, scale_bps)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn exp_k(&mut self, who: &str, kind: &str, good: bool, t: i64, weight_bps: i64, heard: bool, scale_bps: Option<i64>) -> Moved {
        self.s.inner.experience(&self.s.mind.person.values, who, kind, good, t, Experienced { weight_bps: Some(weight_bps), heard, scale_bps })
    }
    pub fn tried(&mut self, worked: bool, weight_bps: i64) -> Moved {
        self.s.inner.tried(worked, weight_bps, None)
    }
    pub fn done_to(&mut self, weight_bps: i64) -> Moved {
        self.s.inner.done_to(weight_bps, None)
    }
    pub fn attached(&self, b: Bond) -> i64 {
        self.s.inner.attached_to(b, None)
    }
    /// A cited rate of turning to someone, swayed by trust and agency for one who takes initiative, and culture's
    /// lean (citizen.ts `reads`).
    pub fn reads(&mut self, bps: i64, who: &str, conduct: Option<Conduct>, t: i64) -> i64 {
        let read = if self.s.initiative {
            let (st, sa) = (self.s.wants.p.sway.trust, self.s.wants.p.sway.agency);
            let z = self.zt(who, self.s.last_seen);
            wants::swayed(wants::swayed(bps, z, st), self.za(), sa)
        } else {
            bps
        };
        let _ = t;
        match conduct {
            Some(c) => self.term(read, c, self.s.last_seen),
            None => read,
        }
    }
    /// culture's lean on a rate (`cul.term`): none without culture.
    pub fn term(&self, bps: i64, c: Conduct, t: i64) -> i64 {
        match &self.s.culture {
            Some(cul) => cul.term(&self.env(), bps, c, t, 1),
            None => bps,
        }
    }
    /// What culture needs of the person at a call (citizen.ts's `CultureEnv`).
    pub fn env(&self) -> Standing {
        let vals = &self.s.mind.person.values;
        Standing {
            z: Value::ALL.map(|v| self.s.inner.z_of(vals, v) as f64 / 100.0),
            conformity: self.s.mind.person.temperament.conformity as f64 / 10_000.0,
            belonging: (self.s.mind.person.weights[Need::Belonging.index()] - 10_000) as f64 / 10_000.0,
            integrity: self.s.inner.integrity(vals) as f64 / 10_000.0,
        }
    }
    /// The teachings in the book, by who teaches them (refreshed when the mind is given the book).
    pub fn refresh_teachings(&mut self, book: &Book) {
        let mut m: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for r in book.assertions() {
            m.entry(r.speaks_for.clone().unwrap_or_else(|| r.author.clone())).or_default().push(r.id.clone());
        }
        self.s.teachings = m;
        self.s.practice_hosts = book.practices().map(|r| (r.id.clone(), r.speaks_for.clone().unwrap_or_else(|| r.author.clone()))).collect();
    }
    /// How strongly we hold what a host teaches (the most of its teachings: citizen.ts `holdTo`).
    pub fn hold_to(&self, host: &str) -> i64 {
        self.s.teachings.get(host).map_or(0, |ids| ids.iter().map(|id| *self.s.beliefs.get(id).unwrap_or(&0)).max().unwrap_or(0)).max(0)
    }
    /// Nearer certainty, by a share of the way (citizen.ts `strengthen`), and the record of it.
    pub fn strengthened(&mut self, host: &str, bps: i64) -> Json {
        let before = self.hold_to(host);
        for id in self.s.teachings.get(host).cloned().unwrap_or_default() {
            let b = *self.s.beliefs.get(&id).unwrap_or(&0);
            self.s.beliefs.insert(id, b + round(((10_000 - b) * bps) as f64 / 10_000.0));
        }
        json!({ "host": host, "before": before, "after": self.hold_to(host) })
    }
    /// What we hear of others now (citizen.ts `newsNow`), by who told it.
    pub fn news_now(&self, t: i64) -> impl Iterator<Item = (&String, &News)> {
        let days = self.p.news_days;
        self.s.told_us.iter().filter(move |(_, (_, at))| t - at <= days * DAY).map(|(k, (n, _))| (k, n))
    }
    pub fn fear_of(&self, who: &str, t: i64) -> i64 {
        self.s.feelings.level(Emotion::Fear, who, t)
    }
    pub fn level(&self, n: Need) -> i64 {
        self.s.levels[n.index()]
    }
    pub fn satisfaction_now(&self) -> i64 {
        person::satisfaction(&self.s.mind.person, &self.s.levels)
    }
    /// How far attachment sits from the town's (citizen.ts `zAttached`).
    pub fn z_attached(&self, which: Bond) -> f64 {
        let mean = if which == Bond::Place { self.p.attach_mean_place } else { self.p.attach_mean_trade };
        match mean {
            None => 0.0,
            Some(m) => ((self.attached(which) - m) as f64 / 3_000.0).clamp(-3.0, 3.0),
        }
    }
    pub fn adult(&self, life: &Life) -> bool {
        life.adult
    }
}

// ------------------------------------------------------------------ recording

impl CitizenMind {
    /// A decision, recorded and numbered (citizen.ts `decision`); `also`: other names its outcomes come under.
    pub fn decision(&mut self, cx: &mut Cx, mut d: Map<String, Json>, also: &[&str]) -> u64 {
        self.s.decisions += 1;
        let n = self.s.decisions;
        d.insert("n".into(), json!(n));
        let domain = d.get("domain").and_then(Json::as_str).unwrap_or_default().to_string();
        if let Some(c) = d.get("choice").and_then(Json::as_str) {
            self.s.chose.insert(format!("{domain}:{c}"), n);
        }
        for a in also {
            self.s.chose.insert(format!("{domain}:{a}"), n);
        }
        cx.decided(Json::Object(d));
        n
    }
    /// Something we came to know of how a choice went (citizen.ts `outcome`): numbered by the decision it follows
    /// where ours, then appraised.
    pub fn outcome_rec(&mut self, cx: &mut Cx, life: &Life, book: Option<&Book>, mut o: Map<String, Json>, own: bool) {
        let domain = o.get("domain").and_then(Json::as_str).unwrap_or_default().to_string();
        let option = o.get("option").and_then(Json::as_str).unwrap_or_default().to_string();
        if own && !o.contains_key("of") {
            if let Some(n) = self.s.chose.get(&format!("{domain}:{option}")) {
                o.insert("of".into(), json!(n));
            }
        }
        if let Some((paper, read)) = self.s.last_read.take() {
            if o.get("paper").and_then(Json::as_str) == Some(paper.as_str()) || o.contains_key("read_pending") {
                o.insert("read".into(), read);
            } else {
                self.s.last_read = Some((paper, read));
            }
        }
        o.remove("paper");
        o.remove("read_pending");
        let kind = o.get("kind").and_then(Json::as_str).unwrap_or_default().to_string();
        let t = o.get("t").and_then(Json::as_i64).unwrap_or(cx.t);
        let facts = o.get("facts").cloned().unwrap_or(Json::Null);
        cx.learned(Json::Object(o));
        self.appraised(cx, life, book, t, &domain, &option, &kind, &facts, own);
    }
    pub fn out(&mut self, cx: &mut Cx, life: &Life, t: i64, domain: &str, option: &str, kind: &str, way: &str, facts: Json) {
        let mut o = Map::new();
        o.insert("t".into(), json!(t));
        o.insert("domain".into(), json!(domain));
        o.insert("option".into(), json!(option));
        o.insert("kind".into(), json!(kind));
        o.insert("way".into(), json!(way));
        if facts.as_object().map_or(false, |f| !f.is_empty()) {
            o.insert("facts".into(), facts);
        }
        self.outcome_rec(cx, life, None, o, true);
    }
    /// What the mind learns of an option from how it went (citizen.ts `learn` / `hearOf`), with the record of it.
    pub fn learn_rec(&mut self, cx: &mut Cx, life: &Life, domain: &str, option: &str, payoff: i64, mut o: Map<String, Json>, own: bool, heard: bool) {
        let (before, first) = self.was(domain, option);
        if heard {
            self.s.mind.hear(domain, option, payoff);
        } else {
            self.s.mind.learn(domain, option, payoff, &BTreeMap::new());
        }
        let mut learned = json!({ "payoff": payoff, "before": before, "after": self.now(domain, option) });
        if first {
            learned["first"] = json!(true);
        }
        if heard {
            learned["heard"] = json!(true);
        }
        o.insert("domain".into(), json!(domain));
        o.insert("option".into(), json!(option));
        o.insert("learned".into(), learned);
        self.outcome_rec(cx, life, None, o, own && !heard);
    }
    pub fn was(&self, domain: &str, option: &str) -> (i64, bool) {
        (self.s.mind.learned_get(domain, option), !self.s.mind.learned_known(domain, option))
    }
    pub fn now(&self, domain: &str, option: &str) -> i64 {
        self.s.mind.learned_get(domain, option)
    }
    /// A feeling, for the record (citizen.ts `felt`): `add` more by a share, else at least this strongly.
    pub fn felt(&mut self, add: bool, e: Emotion, about: &str, bps: i64, t: i64) -> Json {
        let before = self.s.feelings.level(e, about, t);
        if add {
            self.s.feelings.add(e, about, bps, t);
        } else {
            self.s.feelings.feel(e, about, bps, t);
        }
        json!({ "emotion": e.name(), "about": about, "bps": bps, "before": before, "after": self.s.feelings.level(e, about, t) })
    }
    /// A want born of something that happened (citizen.ts `wantBorn`): nothing, for one who takes no initiative.
    pub fn want_born(&mut self, t: i64, about: &str, seeks: &[&str], size: f64, need: Need, whom: Option<&str>, against: Option<(&str, &str, &str)>, with: Option<&str>, from: &str) -> Option<usize> {
        if !self.s.initiative {
            return None;
        }
        let weight = round(self.s.wants.p.event_bps as f64 * size.clamp(0.1, 1.5) * self.s.mind.person.weights[need.index()] as f64 / 15_000.0);
        let mut w = Want::new(about, seeks.iter().filter_map(|k| seek(k)).collect(), weight, t, origin_of(from));
        w.against = against.map(|(r, k, b)| wants::Against { record: r.into(), kind: k.into(), by: b.into() });
        w.whom = whom.map(String::from);
        w.with = with.map(String::from);
        self.s.wants.born(w, t).map(|_| self.s.wants.all().len())
    }
}

// ------------------------------------------------------------------ appraising what happened (citizen.ts `appraised`)

impl CitizenMind {
    /// What a thing that happened does to trust, agency and the rest (citizen.ts `appraised`): every outcome passes
    /// here once.
    #[allow(clippy::too_many_arguments)]
    pub fn appraised(&mut self, cx: &mut Cx, life: &Life, book: Option<&Book>, t: i64, domain: &str, who: &str, kind: &str, facts: &Json, own: bool) {
        let fs = |k: &str| facts.get(k).and_then(Json::as_str).unwrap_or_default().to_string();
        let key = format!("{domain}:{kind}");
        let retired = life.retired;
        if self.s.initiative && own {
            match key.as_str() {
                "job:ended" if fs("by") != "self" && !retired => {
                    let size = 0.7 + self.attached(Bond::Trade) as f64 / 20_000.0;
                    self.want_born(t, "let_go", &["work", "money.to"], size, Need::Status, Some(who), None, None, "event");
                    self.s.trouble_to_tell.push(("let_go".into(), who.into()));
                }
                "job:unpaid" => {
                    self.want_born(t, "unpaid", &["money.to"], 1.0, Need::Security, Some(who), None, None, "event");
                }
                "home:notice_received" => {
                    let by = fs("from");
                    if let (false, Some(lease)) = (by.is_empty(), life.lease.clone()) {
                        self.want_born(t, "notice", &["occupancy"], 1.0, Need::Shelter, Some(&by), Some((&lease, "notice", &by)), None, "event");
                        self.s.trouble_to_tell.push(("notice".into(), by));
                    }
                }
                "practice:turned_away" => {
                    let host = fs("host");
                    if !host.is_empty() {
                        self.want_born(t, "slight", &[], 0.3, Need::Belonging, Some(&host), None, None, "event");
                    }
                }
                _ => {}
            }
        }
        let k = self.kind_of(who);
        match key.as_str() {
            "job:hired" => {
                self.s.employers.insert(who.into());
                self.tried(true, 10000);
                self.exp_k(who, "companies", true, t, 10000, false, None);
                self.s.inner.remember(inner::Remembered { t, what: "hired".into(), about: Some(who.into()), size: 2_000, by: None });
            }
            "job:paid" => {
                self.exp_k(who, &k, true, t, 2000, false, None);
            }
            "job:rise" => {
                self.exp_k(who, &k, true, t, 10000, false, None);
            }
            "job:unpaid" => {
                self.exp_k(who, &k, false, t, 20000, false, None);
                self.done_to(10000);
                self.s.ties.add(who, -3_000, t, Some("unpaid"));
                self.s.feelings.feel(Emotion::Fear, who, 3_000, t);
                self.s.inner.remember(inner::Remembered { t, what: "unpaid".into(), about: Some(who.into()), size: 4_000, by: None });
            }
            "job:no_work" => {
                self.exp_k(who, &k, false, t, 10000, false, None);
                self.done_to(5000);
            }
            "job:ended" if fs("by") != "self" => {
                self.exp_k(who, &k, false, t, 10000, false, None);
                self.done_to(10000);
                self.s.ties.add(who, -1_000, t, Some("let_go"));
                let c = 0.5 + self.attached(Bond::Trade) as f64 / 20_000.0;
                self.happened("job_lost", t, Some(who), Some(c));
                self.s.let_go = Some((who.into(), t));
            }
            "job:told" => {
                if !own && (self.s.inner.trusted(who).is_some() || life.employer.as_deref() == Some(who)) {
                    let good = facts.get("paid") != Some(&Json::Bool(false));
                    self.exp_k(who, &k, good, t, 10000, true, None);
                }
            }
            "home:lease_signed" => {
                self.tried(true, 10000);
                self.s.inner.remember(inner::Remembered { t, what: "housed".into(), about: Some(who.into()), size: 2_000, by: None });
            }
            "home:moved_in" => {
                self.tried(true, 5000);
            }
            "home:renewed" => {
                if let Some(l) = &life.landlord {
                    let kk = self.kind_of(l);
                    self.exp_k(l, &kk, true, t, 10000, false, None);
                }
            }
            "home:rent_increase" => {
                let n = |x: &str| facts.get(x).and_then(Json::as_i64).unwrap_or(0);
                if let (Some(l), true) = (life.landlord.clone(), n("rent") > n("was")) {
                    let kk = self.kind_of(&l);
                    self.exp_k(&l, &kk, false, t, 10000, false, None);
                    self.done_to(5000);
                    self.s.ties.add(&l, -1_000, t, Some("rent_rise"));
                    self.s.feelings.feel(Emotion::Fear, &l, 2_000, t);
                }
            }
            "home:notice_received" => {
                let by = fs("from");
                if !by.is_empty() {
                    let kk = self.kind_of(&by);
                    self.exp_k(&by, &kk, false, t, 20000, false, None);
                    self.done_to(10000);
                    self.s.ties.add(&by, -3_000, t, Some("notice"));
                    self.s.feelings.feel(Emotion::Fear, &by, 5_000, t);
                    self.happened("evicted", t, Some(&by), None);
                    self.s.noticed_by = Some((by, t));
                }
            }
            "membership:joined" => {
                self.tried(true, 5000);
            }
            "membership:rise_won" => {
                if let Some(u) = self.p.union.clone() {
                    self.exp_k(&u, "unions", true, t, 20000, false, None);
                }
                self.tried(true, 10000);
            }
            "practice:attended" => {
                let host = fs("host");
                if !host.is_empty() {
                    let kk = self.kind_of(&host);
                    self.exp_k(&host, &kk, true, t, 2000, false, None);
                }
            }
            "practice:turned_away" => {
                self.tried(false, 10000);
                let host = fs("host");
                self.happened("turned_away", t, Some(&host), None);
                if !host.is_empty() {
                    self.s.refused_by.insert(host);
                }
            }
            "goal:met" => {
                self.tried(true, 10000);
            }
            "goal:not_met" => {
                self.tried(false, 10000);
            }
            "venture:founded" => {
                self.tried(true, 20000);
                self.s.inner.remember(inner::Remembered { t, what: "founded".into(), about: Some(fs("firm")), size: 5_000, by: None });
            }
            "venture:refused" => {
                self.tried(false, 10000);
            }
            _ => {}
        }
        let _ = (cx, book);
    }

    /// inner.ts `happened`, with the person's values (a shock moves them in place; what they weigh follows at the
    /// next drift, as in TS).
    pub fn happened(&mut self, what: &str, t: i64, about: Option<&str>, closeness: Option<f64>) {
        let o = Happening { about: about.map(String::from), closeness_bps: closeness.map(|c| round(c * 10_000.0)), size: None };
        self.s.inner.happened(&mut self.s.mind.person.values, what, t, o);
    }
}

// ------------------------------------------------------------------ what life may read

impl Outlook for CitizenMind {
    fn value_z(&self, value: &str) -> i64 {
        Value::from_name(value).map_or(0, |v| round(self.z_value(v) * 100.0))
    }
    fn facet(&self, facet: &str) -> i64 {
        let t = &self.s.mind.person.temperament;
        match facet {
            "openness" => t.openness,
            "conformity" => t.conformity,
            "prestige" => t.prestige,
            _ => 5_000,
        }
    }
    /// (Read only: a person not yet trusted reads as the town's figure for its kind, as the entry would start.)
    fn trust_z(&self, who: &str) -> i64 {
        let mut inner = self.s.inner.clone();
        inner.z_trust(&self.s.mind.person.values, who, &self.kind_of(who), self.s.last_seen)
    }
    fn agency_z(&self) -> i64 {
        self.s.inner.z_agency()
    }
    fn attached(&self, to: &str) -> i64 {
        match to {
            "place" => self.attached(Bond::Place),
            "trade" => self.attached(Bond::Trade),
            "group" => self.attached(Bond::Group),
            _ => 0,
        }
    }
    fn feeling(&self, emotion: &str, about: &str, t: i64) -> i64 {
        Emotion::from_name(emotion).map_or(0, |e| self.s.feelings.level(e, about, t))
    }
    fn affinity(&self, who: &str, t: i64) -> i64 {
        self.s.ties.affinity(who, t)
    }
    fn knows(&self, who: &str) -> bool {
        self.s.people_known.contains(who)
    }
    fn contact(&self, who: &str) -> bool {
        self.s.contacts.iter().any(|(c, _)| c == who)
    }
    fn contacts(&self) -> usize {
        self.s.contacts.len()
    }
    fn closest(&self, n: usize, t: i64) -> Vec<Tie> {
        self.s.ties.closest(n, t).into_iter().map(|x| Tie { who: x.who.clone(), affinity_bps: x.affinity, trust_bps: Some(x.trust) }).collect()
    }
    fn learned(&self, domain: &str, option: &str) -> Option<i64> {
        self.s.mind.learned_known(domain, option).then(|| self.s.mind.learned_get(domain, option))
    }
    fn wants(&self) -> Vec<WantView> {
        if !self.s.initiative {
            return vec![];
        }
        let mut v: Vec<WantView> = self.s.wants.all().iter().map(view_of).collect();
        v.sort_by(|a, b| b.weight_bps.cmp(&a.weight_bps).then(a.about.cmp(&b.about)));
        v
    }
    fn initiative(&self) -> bool {
        self.s.initiative
    }
    fn pursuing(&self, method: &str) -> bool {
        if self.s.initiative {
            let way = match method {
                "spend less" => "self",
                "better work" => "offer:employment",
                "cheaper home" => "offer:lease",
                "catch up more" => "ties",
                "try a gathering" => "practice",
                m => m,
            };
            self.s.wants.taking(way)
        } else {
            self.s.pursuits.values().any(|x| x.method() == Some(method))
        }
    }
    fn at_gathering(&self, t: i64) -> Option<String> {
        self.s.attending.as_ref().filter(|a| !a.gone && t < a.until).map(|a| a.space.clone())
    }
    /// citizen.ts's `patience` (a multiplier about 0.5 to 1.8), in thousandths: life reads it for leaving town.
    fn patience_days(&self) -> i64 {
        round(self.patience() * 1_000.0)
    }
    fn satisfaction(&self, life: &Life) -> i64 {
        person::satisfaction(&self.s.mind.person, &self.need_levels(life, life.t))
    }
}

/// A want as life may see it.
pub fn view_of(w: &Want) -> WantView {
    WantView {
        about: w.about.clone(),
        seeks: w.seeks.iter().map(|k| k.name().to_string()).collect(),
        whom: w.whom.clone(),
        against: w.against.as_ref().map(|a| (a.record.clone(), a.kind.clone(), a.by.clone())),
        weight_bps: w.weight,
        since: w.since,
    }
}

impl CitizenMind {
    /// How long a way is given (citizen.ts 3357's `patience`: those who value tradition and security, and those long
    /// here, holding on longer).
    pub fn patience(&self) -> f64 {
        let sw = &self.p.sway;
        let ini = self.s.initiative;
        let x = 1.0 + sw.patience_tradition * self.z_value(Value::Tradition) + sw.patience_security * self.z_value(Value::Security)
            + if ini { self.s.wants.p.sway.attachment * self.z_attached(Bond::Place) } else { 0.0 };
        x.clamp(0.5, if ini { 1.8 } else { 1.5 })
    }
}

pub fn seek(k: &str) -> Option<wants::SeekKey> {
    wants::SEEK_KEYS.iter().copied().find(|x| x.name() == k)
}

pub fn conduct(name: &str) -> Option<Conduct> {
    Conduct::from_name(name)
}

// ------------------------------------------------------------------ how satisfied: needs as life now stands

impl CitizenMind {
    /// How well each need is met (citizen.ts `needLevels`): placeholders for how each is read from a life, as TS had
    /// them.
    pub fn need_levels(&self, life: &Life, t: i64) -> Needs {
        let home = matches!(life.housed, Housed::Own | Housed::Rents);
        let living = life.housed == Housed::Lodging;
        let outgoings = self.p.essentials.max(life.rent.or(life.rent_share).unwrap_or(0) + self.p.essentials);
        let with_others = life.household > 1;
        let talked = self.s.talked.values().filter(|&&x| t - x <= MONTH).count().min(3) as i64;
        let close = self.s.ties.closest(5, t).iter().filter(|x| x.affinity >= 1_000).count().min(3) as i64;
        let group = self.attached(Bond::Group);
        let place = self.attached(Bond::Place);
        let trade = self.attached(Bond::Trade);
        let belief = self.s.beliefs.values().copied().max().unwrap_or(0).max(0);
        let working = life.employer.is_some();
        let mut n = [0i64; 7];
        n[Need::Subsistence.index()] = round((life.goods_held * 10_000) as f64 / self.p.essentials_units.max(1) as f64).min(10_000);
        n[Need::Shelter.index()] = if home { 10_000 } else if living { 6_000 } else { 0 };
        n[Need::Security.index()] = round((life.savings as f64 * 2_500.0) / outgoings.max(1) as f64).min(10_000);
        n[Need::Social.index()] = (if with_others { 5_000 } else { 2_000 }) + 1_000 * talked;
        n[Need::Status.index()] = if working { 7_000 } else if life.retired { 6_000 } else { 3_000 };
        n[Need::Belonging.index()] = (3_200 + if with_others { 3_000 } else { 0 } + 1_000 * close + round(group as f64 / 5.0) + round(place as f64 / 10.0) - self.s.inner.dent(Need::Belonging, t)).clamp(0, 10_000);
        n[Need::Meaning.index()] = (3_700
            + round(belief as f64 * 0.3)
            + if working || life.own_work.is_some() { 1_500 + round(trade as f64 / 10.0) } else if life.retired { 1_000 } else { 0 }
            + if life.children > 0 { 2_000 } else { 0 }
            + round(group as f64 / 10.0)
            - self.s.inner.dent(Need::Meaning, t))
        .clamp(0, 10_000);
        n
    }

    fn circumstances(&self, life: &Life, bedrooms: Option<u32>) -> person::Circumstances {
        person::Circumstances { monthly_income: life.monthly_income, savings: life.savings, homeless: life.housed == Housed::None, home_bedrooms_needed: bedrooms.map(i64::from), essentials: Some(self.p.essentials) }
    }

    /// The mind's decision, recorded with the state behind it (citizen.ts `decide`).
    pub fn decide_rec(&mut self, cx: &mut Cx, life: &Life, d: &Decide, levels: Needs) -> Decision {
        let t = cx.t;
        let doubt = d.doubt.unwrap_or_else(|| if MONEY_MATTERS.contains(&d.domain.as_str()) { round(self.s.feelings.level(Emotion::Fear, "money", t) as f64 / 2.0) } else { 0 });
        let circ = self.circumstances(life, d.bedrooms_needed);
        let options: Vec<person::Choice> = d.options.iter().map(|c| person::Choice { key: c.key.clone(), facts: c.facts.as_ref().map(facts_in), others: c.others, meaning: c.meaning }).collect();
        let mut rng = cx.rng(d.purpose.as_deref().unwrap_or(&d.domain));
        let ask = person::Ask { options, current: d.current.clone(), levels, circ: circ.clone(), satisfied_here: d.satisfied_here, doubt: Some(doubt) };
        let got = self.s.mind.decide(&d.domain, &mut rng, &ask);
        let emotion = self.s.feelings.strongest(t);
        let held: Map<String, Json> = self.s.beliefs.iter().filter(|(_, &b)| b > 0).map(|(k, b)| (k.clone(), json!(b))).collect();
        let goal = self.s.pursuits.values().find(|x| x.method().is_some()).map(|x| json!({ "goal": x.goal, "method": x.method() }));
        let score: BTreeMap<&str, i64> = got.scores.iter().map(|x| (x.key.as_str(), x.score)).collect();
        let mut sorted = d.options.clone();
        sorted.sort_by(|a, b| a.key.cmp(&b.key));
        let seen: Vec<Json> = sorted
            .iter()
            .map(|x| {
                let mut o = json!({ "key": x.key, "score": score.get(x.key.as_str()).copied().unwrap_or(0) });
                if let Some(f) = &x.facts {
                    o["facts"] = serde_json::to_value(f).unwrap_or(Json::Null);
                }
                if let Some(n) = x.others.filter(|&n| n != 0) {
                    o["others"] = json!(n);
                }
                if let Some(m) = x.meaning.filter(|&m| m != 0) {
                    o["meaning"] = json!(m);
                }
                if self.s.mind.learned_known(&d.domain, &x.key) {
                    o["learned"] = json!(self.s.mind.learned_get(&d.domain, &x.key));
                }
                o
            })
            .collect();
        let mut rec = Map::new();
        rec.insert("t".into(), json!(t));
        rec.insert("domain".into(), json!(d.domain));
        rec.insert("strategy".into(), json!(got.strategy.name()));
        if let Some(k) = &got.key {
            rec.insert("choice".into(), json!(k));
        }
        rec.insert("options".into(), Json::Array(seen));
        if let Some(c) = &d.current {
            rec.insert("current".into(), json!(c));
        }
        let mut circ_j = json!({ "monthly_income": circ.monthly_income, "savings": circ.savings, "homeless": circ.homeless });
        if let Some(b) = circ.home_bedrooms_needed {
            circ_j["bedrooms_needed"] = json!(b);
        }
        circ_j["essentials"] = json!(self.p.essentials);
        rec.insert("circumstances".into(), circ_j);
        if let Some(x) = d.satisfied_here {
            rec.insert("satisfied_here".into(), json!(x));
        }
        if doubt != 0 {
            rec.insert("doubt".into(), json!(doubt));
        }
        if !self.s.person_told {
            let pp = &self.s.mind.person;
            rec.insert(
                "person".into(),
                json!({ "values": named(&Value::ALL.map(|v| (v.name(), pp.values[v.index()]))), "temperament": { "openness": pp.temperament.openness, "conformity": pp.temperament.conformity, "prestige": pp.temperament.prestige }, "weights": named(&Need::ALL.map(|n| (n.name(), pp.weights[n.index()]))) }),
            );
            self.s.person_told = true;
        }
        let mut state = json!({ "mind": person::MIND_VERSION, "needs": named(&Need::ALL.map(|n| (n.name(), levels[n.index()]))), "satisfaction": got.satisfaction.unwrap_or(0), "certainty": got.certainty.unwrap_or(0) });
        if let Some(e) = emotion {
            state["emotion"] = json!({ "kind": e.kind.name(), "about": e.about, "bps": e.bps });
        }
        if !held.is_empty() {
            state["beliefs"] = Json::Object(held);
        }
        if let Some(g) = goal {
            state["goal"] = g;
        }
        rec.insert("state".into(), state);
        let n = self.decision(cx, rec, &[]);
        Decision { key: got.key, strategy: got.strategy.name().into(), scores: got.scores.into_iter().map(|x| (x.key, x.score)).collect(), satisfaction: got.satisfaction, certainty: got.certainty, n: Some(n) }
    }
}

pub fn named(xs: &[(&str, i64)]) -> Json {
    Json::Object(xs.iter().map(|(k, v)| (k.to_string(), json!(v))).collect())
}

fn facts_in(f: &Facts) -> person::Facts {
    serde_json::from_value(serde_json::to_value(f).unwrap_or(Json::Null)).unwrap_or_default()
}

// ------------------------------------------------------------------ the seam

impl Mind for CitizenMind {
    fn woke(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life) {
        let t = cx.t;
        // Where the hours since we last woke went, by where we are (citizen.ts `wake`, `whereAt`).
        if self.s.last_seen == 0 && t > DAY {
            self.s.inner.hours_begin(t);
        } else if pic.body.as_ref().map_or(false, |b| b.present) {
            let here = pic.body.as_ref().and_then(|b| b.in_space.clone());
            let cat = self.where_at(here.as_deref(), life);
            self.s.inner.spent(cat, t - self.s.last_seen);
        }
        self.s.last_seen = t;
        // (There, from a trip we set off on: how long the way took, remembered for the next time.)
        if let Some((sp, from)) = self.s.setting_off.clone() {
            if pic.body.as_ref().and_then(|b| b.in_space.as_deref()) == Some(sp.as_str()) {
                self.s.way_to.insert(sp, t - from);
                self.s.setting_off = None;
            } else if t - from > DAY {
                self.s.setting_off = None;
            }
        }
        self.refresh_teachings(book);
        for a in std::mem::take(&mut cx.answers) {
            self.answered(a);
        }
        if let Some(Seen::Records { records, search: true }) = pic.channels.get("petitions") {
            self.s.petitions_found = records.clone();
        }
        // The founded group's id, as the world gave it (citizen.ts 1310-1326).
        if self.s.pending_group && self.s.begun.is_some() {
            let id = pic.outcomes.iter().find_map(|o| o.created.as_ref().and_then(|c| c.get("founded")).cloned());
            if let Some(id) = id {
                self.s.pending_group = false;
                let b = self.s.begun.take().unwrap();
                self.s.my_group = Some((id.clone(), b.shape.clone(), b.want.about.clone()));
                self.tried(true, 20_000);
                self.s.inner.remember(inner::Remembered { t, what: "founded".into(), about: Some(id.clone()), size: 5_000, by: None });
                let piece = b.piece.clone().unwrap_or(Json::Null);
                let composer = if piece.is_null() { json!("none") } else if piece.get("declined") == Some(&Json::Bool(true)) { json!("declined") } else { piece.get("model").cloned().unwrap_or(json!("none")) };
                let mut facts = json!({ "org": id, "idea": b.brief["idea"], "about": b.want.about, "sharers": b.sharers.len(), "name_by": b.name_by.clone().unwrap_or_else(|| "code".into()), "composer": composer, "dark": b.brief["dark"].as_array().map_or(0, |d| d.len()) });
                if let Some(w) = &b.want.whom {
                    facts["whom"] = json!(w);
                }
                let mut o = Map::new();
                for (k, v) in [("t", json!(t)), ("domain", json!("found")), ("option", json!(b.shape)), ("kind", json!("founded")), ("way", json!("mine")), ("facts", facts), ("brief", b.brief.clone())] {
                    o.insert(k.into(), v);
                }
                self.outcome_rec(cx, life, None, o, true);
            } else if let Some(r) = pic.outcomes.iter().find(|o| o.status == oikos_sight::OutcomeStatus::Refused) {
                let why = r.refusal.as_ref().map(|x| serde_json::to_value(&x.code).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()).unwrap_or_default();
                let shape = self.s.begun.as_ref().map(|b| b.shape.clone()).unwrap_or_default();
                self.out(cx, life, t, "found", &shape, "refused", "mine", json!({ "why": why }));
                self.s.begun = None;
                self.s.pending_group = false;
            }
        }
    }

    fn decide(&mut self, cx: &mut Cx, life: &Life, d: Decide) -> Decision {
        let levels = self.need_levels(life, cx.t);
        self.decide_rec(cx, life, &d, levels)
    }

    fn choose_known(&mut self, cx: &mut Cx, domain: &str, options: &[String], _follows: Option<u64>) -> Option<String> {
        if options.is_empty() {
            return None;
        }
        let mut rng = cx.rng(&format!("{domain}-known"));
        let opts: Vec<(String, i64)> = options.iter().map(|k| (k.clone(), 0)).collect();
        let open = self.s.mind.person.temperament.openness;
        Some(self.s.mind.learned(domain).choose(&mut rng, &opts, open).0)
    }

    fn choose_conduct(&mut self, cx: &mut Cx, _life: &Life, c: ConductAsk) -> crate::citizen::mind::Conduct {
        let t = cx.t;
        let k = conduct(&c.conduct);
        let bps = match (&c.who, c.lean) {
            (Some(who), lean) => {
                let who = who.clone();
                self.reads(c.base_bps, &who, if lean { k } else { None }, t)
            }
            (None, true) => k.map_or(c.base_bps, |k| self.term(c.base_bps, k, t)),
            (None, false) => c.base_bps,
        };
        let does = c.forced || c.draw_bps < bps;
        if let (true, Some(k)) = (c.act, k) {
            if let Some(cul) = &mut self.s.culture {
                cul.act(k, does, t);
            }
        }
        let facts = match (&self.s.culture, k) {
            (Some(cul), Some(k)) => cul.facts(&self.env(), k, t),
            _ => BTreeMap::new(),
        };
        if let Some((domain, yes, no)) = &c.record {
            let mut d = Map::new();
            d.insert("t".into(), json!(t));
            d.insert("domain".into(), json!(domain));
            d.insert("strategy".into(), json!("deliberate"));
            d.insert("choice".into(), json!(if does { yes } else { no }));
            d.insert("options".into(), json!([{ "key": yes, "score": bps }, { "key": no, "score": 10_000 - bps }]));
            if let (Some(cul), Some(k)) = (&self.s.culture, k) {
                if let Some(n) = cul.norm(&self.env(), k, t) {
                    d.insert("norm".into(), serde_json::to_value(n).unwrap_or(Json::Null));
                }
            }
            self.decision(cx, d, &[]);
        }
        crate::citizen::mind::Conduct { does, bps, facts }
    }

    fn outcome(&mut self, cx: &mut Cx, life: &Life, o: Outcome) {
        let mut rec = Map::new();
        rec.insert("t".into(), json!(cx.t));
        rec.insert("kind".into(), json!(o.kind));
        rec.insert("way".into(), json!(way_name(o.way)));
        if let Some(f) = &o.from {
            rec.insert("from".into(), json!(f));
        }
        if !o.facts.is_empty() {
            rec.insert("facts".into(), Json::Object(o.facts.iter().map(|(k, v)| (k.clone(), v.clone())).collect()));
        }
        if let Some(n) = o.of {
            rec.insert("of".into(), json!(n));
        }
        if let Some(p) = &o.paper {
            rec.insert("paper".into(), json!(p));
        }
        // (What life tells us of a debt paid us, of our home complained of, of a notice lapsed: for wants met.)
        if o.domain == "debt" && o.kind == "settled" {
            if let (Some(c), Some(n)) = (o.facts.get("claim").and_then(Json::as_str), o.facts.get("paid").and_then(Json::as_i64)) {
                self.s.settled_to_us.insert(c.to_string(), n);
            }
        }
        if o.domain == "home" && matches!(o.kind.as_str(), "possession_dismissed" | "plan_ordered" | "notice_lapsed") {
            if let Some(l) = &life.lease {
                self.s.notice_over.insert(l.clone());
            }
        }
        if o.domain == "complaint" {
            self.s.complained = o.kind == "made";
        }
        let rise = o.domain == "job" && o.kind == "rise" && o.way == Way::Published;
        let unpaid = o.domain == "job" && o.kind == "unpaid";
        match o.payoff {
            Some(pay) => self.learn_rec(cx, life, &o.domain, &o.option, pay, rec, !o.heard, o.heard),
            None => {
                rec.insert("domain".into(), json!(o.domain));
                rec.insert("option".into(), json!(o.option));
                self.outcome_rec(cx, life, None, rec, !o.heard);
            }
        }
        // (Wages unpaid a period and more: angry with them, citizen.ts 1936.)
        if unpaid {
            self.s.feelings.feel(Emotion::Anger, &o.option, 8_000, cx.t);
        }
        // (A rise in an enterprise agreement, to a member: it paid. Grateful to the union, and surer of what it
        // says: citizen.ts 1263-1272, the mind's half.)
        if let (true, Some(u)) = (rise, self.p.union.clone().filter(|u| life.member_of.contains(u))) {
            let rise_bps = o.facts.get("rise_bps").and_then(Json::as_i64).unwrap_or(0);
            let payoff = (6_000 + rise_bps * 10).min(10_000);
            let (before, first) = self.was("membership", "member");
            self.s.mind.learn("membership", "member", payoff, &BTreeMap::new());
            let grateful = self.felt(true, Emotion::Gratitude, &u, 5_000, cx.t);
            let belief = self.strengthened(&u, 1_000);
            let mut learned = json!({ "payoff": payoff, "before": before, "after": self.now("membership", "member") });
            if first {
                learned["first"] = json!(true);
            }
            let mut r = Map::new();
            for (k, v) in [("t", json!(cx.t)), ("domain", json!("membership")), ("option", json!("member")), ("kind", json!("rise_won")), ("way", json!("published")), ("facts", json!({ "employer": life.employer, "rise_bps": rise_bps })), ("learned", learned), ("felt", json!([grateful])), ("belief", belief)] {
                r.insert(k.into(), v);
            }
            self.outcome_rec(cx, life, None, r, true);
        }
    }

    fn treated(&mut self, cx: &mut Cx, tr: Treated) {
        let t = cx.t;
        let kind = if tr.kind.is_empty() { self.kind_of(&tr.who) } else { tr.kind.clone() };
        let rd = tr.paper.as_deref().and_then(|p| self.read_of(p));
        let rp = self.p.rdial.as_ref().map(|d| d.params.clone());
        let mut moved: BTreeMap<String, reading::Moved> = BTreeMap::new();
        let mv = |m: Moved| reading::Moved { after: m.after, plain: m.plain, before: Some(m.before) };
        if tr.tried {
            let scale = match (&rd, &rp, tr.good) {
                (Some(r), Some(p), false) => Some(reading::failed_agency(&r.shift, p)),
                _ => None,
            };
            let a = self.s.inner.tried(tr.good, 10_000, scale);
            if rd.is_some() {
                moved.insert("agency".into(), mv(a));
            }
        }
        if !tr.tried || tr.weight_bps.is_some() {
            let scale = match (&rd, &rp) {
                (Some(r), Some(p)) => Some(if tr.good { reading::grant_trust(&r.shift, p) } else { reading::refusal_trust(&r.shift, p) }),
                _ => None,
            };
            let e = self.exp_k(&tr.who, &kind, tr.good, t, tr.weight_bps.unwrap_or(10_000), tr.heard, scale);
            if rd.is_some() {
                moved.insert("trust".into(), mv(e));
            }
        }
        if tr.done_to {
            let scale = match (&rd, &rp) {
                (Some(r), Some(p)) => Some(reading::done_to_agency(&r.shift, p)),
                _ => None,
            };
            let a = self.s.inner.done_to(10_000, scale);
            if rd.is_some() {
                moved.insert("agency_done_to".into(), mv(a));
            }
        }
        if let (Some(r), Some(p)) = (&rd, &rp) {
            let by = tr.who.as_str();
            let (anger, fear, tie) = (reading::anger_added(&r.shift, p), reading::fear_added(&r.shift, p), reading::tie_moved(&r.shift, p));
            if anger != 0 {
                let was = self.s.feelings.level(Emotion::Anger, by, t);
                self.s.feelings.add(Emotion::Anger, by, anger, t);
                moved.insert("anger".into(), reading::Moved { after: self.s.feelings.level(Emotion::Anger, by, t), plain: was, before: None });
            }
            if fear != 0 {
                let was = self.s.feelings.level(Emotion::Fear, by, t);
                self.s.feelings.add(Emotion::Fear, by, fear, t);
                moved.insert("fear".into(), reading::Moved { after: self.s.feelings.level(Emotion::Fear, by, t), plain: was, before: None });
            }
            if tie != 0 {
                let was = self.s.ties.affinity(by, t);
                self.s.ties.add(by, tie, t, None);
                moved.insert("tie".into(), reading::Moved { after: self.s.ties.affinity(by, t), plain: was, before: None });
            }
            let bump = reading::recourse_score(&r.shift, p);
            if bump != 0 {
                self.s.recourse_bump.insert(tr.kind.clone(), bump);
            }
            let read = serde_json::to_value(reading::read_facts(r, moved)).unwrap_or(Json::Null);
            // (What the words did goes on the outcome just recorded, as citizen.ts `withRead` puts it on the last: a
            // landing comes after the outcome it moved. Where the outcome comes after, it names the paper and takes it
            // then (`outcome_rec`). Until 2026-10-18 every read waited for an outcome naming its paper, and only one
            // site wrote one, so almost no outcome carried what the words did.)
            match cx.outcomes.last_mut().and_then(Json::as_object_mut).filter(|o| !self.read_follows && !o.contains_key("read")) {
                Some(o) => {
                    o.insert("read".into(), read);
                }
                None => self.s.last_read = Some((r.paper.clone(), read)),
            }
        }
        self.read_follows = false;
    }

    fn event(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, e: Event, ways: &dyn Openings) -> Heard {
        self.refresh_teachings(book);
        self.on_event(cx, pic, book, life, e, ways)
    }

    fn plan(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, ways: &dyn Openings) -> Planned {
        let mut p = self.plan_all(cx, pic, book, life, ways);
        p.intents.append(&mut self.s.pending_intents);
        p
    }

    fn say_how(&mut self, cx: &mut Cx, asker: &str, life: &Life) -> String {
        self.news_of_mine(cx, Some(asker), life)
    }

    fn troubles_to_tell(&mut self) -> Vec<(String, String)> {
        std::mem::take(&mut self.s.trouble_to_tell)
    }

    fn record(&mut self, cx: &mut Cx, life: &Life) {
        self.write_record(cx, life);
    }

    fn words_done(&mut self, _cx: &mut Cx, _idea: &str, ok: bool, _why: Option<&str>) {
        if let Some(b) = &mut self.s.begun {
            b.name_by = Some(if ok { "translator" } else { "code" }.into());
        }
    }

    fn save(&self) -> Result<Json, String> {
        serde_json::to_value(&self.s).map_err(|e| e.to_string())
    }
}

fn way_name(w: Way) -> &'static str {
    match w {
        Way::Mine => "mine",
        Way::Here => "here",
        Way::Published => "published",
        Way::Ask => "ask",
    }
}

// ------------------------------------------------------------------ answers to questions

impl CitizenMind {
    /// A model's answer to a question of ours, as it comes back at the next wake.
    fn answered(&mut self, a: Answer) {
        match a.kind.as_str() {
            "consult" => {
                self.s.awaiting.remove(&a.about);
                self.s.consulted.insert(a.about, (!a.body.is_null()).then_some(a.body));
            }
            "compose" => {
                if let Some(b) = self.s.begun.as_mut().filter(|b| b.brief.get("idea").and_then(Json::as_str) == Some(a.about.as_str())) {
                    b.piece = Some(a.body);
                }
            }
            "reading" => {
                let r = reading::reading_of(&a).filter(|r| !reading::is_no_shift(&r.shift));
                self.s.readings.insert(a.about, r);
            }
            _ => {}
        }
    }

    /// What the words of a paper addressed to us were read to be (citizen.ts `readOf`): only where the reading dial
    /// is on and the reader's filing has come back.
    pub fn read_of(&self, paper: &str) -> Option<PaperRead> {
        self.p.rdial.as_ref()?;
        self.s.readings.get(paper).cloned().flatten()
    }

    /// The model's view, for someone like us, of each option: our own draw from its answer's spread (citizen.ts
    /// `consult`). `Err(())`: asked, waiting for the answer; `Ok(None)`: no sparse mind here, or no answer.
    pub fn consult(&mut self, cx: &mut Cx, about: &str, thing: &str, options: &[(&str, &str)], life: &Life) -> Result<Option<BTreeMap<String, i64>>, ()> {
        if !self.p.consult {
            return Ok(None);
        }
        if self.s.awaiting.contains(about) {
            return Err(());
        }
        match self.s.consulted.get(about) {
            Some(None) => Ok(None),
            Some(Some(a)) => {
                let mut r = cx.rng(&format!("consult-{about}"));
                let mut out = BTreeMap::new();
                if let Some(scores) = a.get("scores").and_then(Json::as_object) {
                    for (k, x) in scores {
                        let mean = x.get("mean").and_then(Json::as_f64).unwrap_or(0.0);
                        let sd = x.get("sd").and_then(Json::as_f64).unwrap_or(0.0);
                        let mut z = -6 * 10_000i64;
                        for _ in 0..12 {
                            z += r.below(10_000) as i64;
                        }
                        out.insert(k.clone(), round(mean + sd * (z as f64 / 10_000.0)));
                    }
                }
                Ok(Some(out))
            }
            None => {
                self.s.awaiting.insert(about.into());
                let pp = &self.s.mind.person;
                cx.ask(Question {
                    kind: "consult".into(),
                    about: about.into(),
                    body: json!({
                        "thing": thing, "about": about,
                        "options": options.iter().map(|(k, w)| json!({ "key": k, "words": w })).collect::<Vec<_>>(),
                        "person": { "values": named(&Value::ALL.map(|v| (v.name(), pp.values[v.index()]))), "needs": named(&Need::ALL.map(|n| (n.name(), self.s.levels[n.index()]))),
                            "monthly_income": life.monthly_income, "savings": life.savings, "household": life.household.max(1) },
                        "participant": self.p.participant,
                    }),
                });
                Err(())
            }
        }
    }

    /// What the hours since the last wake were spent at, by where the body is (citizen.ts `whereAt`).
    fn where_at(&self, space: Option<&str>, life: &Life) -> &'static str {
        let Some(sp) = space else { return "away" };
        if self.s.attending.as_ref().map_or(false, |a| a.space == sp) {
            return "gathering";
        }
        if life.workplace.as_deref() == Some(sp) {
            return "work";
        }
        if let Some(b) = &self.p.school_building {
            if crate::common::structure_of(sp) == b {
                return "learning";
            }
        }
        if self.p.care_waiting.as_deref() == Some(sp) {
            return "care";
        }
        let tail = sp.rfind("/dwelling.").map(|i| &sp[i + "/dwelling.".len()..]);
        let dwelling = tail.map_or(false, |x| !x.is_empty() && x.chars().all(|c| c.is_ascii_digit()));
        if life.dwelling.as_deref() == Some(sp) || dwelling {
            return "home";
        }
        "away"
    }
}

pub fn origin_of(from: &str) -> wants::Origin {
    match from {
        "need" => wants::Origin::Need,
        "other" => wants::Origin::Other,
        _ => wants::Origin::Event,
    }
}
