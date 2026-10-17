//! What a firm, a landlord or another organisation wants (ported from participants/src/behaviour/orgwants.ts;
//! docs/design/ai-citizens.md 10a; docs/behaviour/firm-wants.md): to keep trading, to grow, to keep a customer, a
//! tenant or a worker, to be rid of one, to pay less, to be thought well of. The wants are the organisation's, held in
//! its own record and acted on by whoever holds its posts; how much each weighs is drawn from the values of whoever
//! owns most of it, so two shops do not behave alike because their owners do not. Its routines (docs/behaviour/
//! firms.md) remain what it does when no want presses: character sways the routines' own levers about the town's
//! mean, and decides how it answers when someone asks something of it.
//!
//! Arithmetic only: no model, no draw but from the streams it is handed. Every size is a parameter (`OrgParams`); all
//! are PLACEHOLDERS (no source was found for how often a landlord holds a rent or an employer gives a rise).
//!
//! Decided fresh: the wants book is lane A2's (`mind::wants::Wants`), which is not in this lane's tree; `Org<W>` holds
//! any `W: Wanting` (the two things the organisation reads of it: the events since last asked, and its record
//! section), and the integration step names `Org<mind::wants::Wants>` with a three-line `impl Wanting`. A character is
//! a z-score in standard deviations (a plain `f64`; only `+ - * /` and `Math.round`'s half up are used, so it is the
//! same on every machine), written to the record as basis points.

use super::practice::{Practice, PracticeOf, PracticeParams, PracticeRow, PRACTICES};
use crate::Cx;
use oikos_core::rng::Rng;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, VecDeque};

pub const ORG_WANTS: [&str; 6] = ["keep_trading", "grow", "keep", "be_rid", "pay_less", "standing"];

/// How much each standing want weighs with an organisation, in standard deviations from the town's mean owner.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Character {
    pub keep_trading: f64,
    pub grow: f64,
    pub keep: f64,
    pub be_rid: f64,
    pub pay_less: f64,
    pub standing: f64,
}

impl Character {
    pub fn get(&self, want: &str) -> f64 {
        match want {
            "keep_trading" => self.keep_trading,
            "grow" => self.grow,
            "keep" => self.keep,
            "be_rid" => self.be_rid,
            "pay_less" => self.pay_less,
            _ => self.standing,
        }
    }
}

/// The town's spread of one of Schwartz's values (basis points).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spread {
    pub mean_bps: i64,
    pub sd_bps: i64,
}

/// An organisation's character from its owner's values (Schwartz's ten, as the owner's own record has them), each a
/// mean of how far the owner sits from the town on the values that speak to it. The mapping is ours, to test against
/// data: security and tradition keep a business going; achievement, stimulation and power grow it; benevolence and
/// conformity hold on to those it deals with; power without benevolence is rid of them; power and achievement without
/// universalism or benevolence pay less; conformity, benevolence and universalism care how it is thought of.
pub fn character_of(owner: Option<&BTreeMap<String, i64>>, pop: &BTreeMap<String, Spread>) -> Character {
    let z = |v: &str| -> f64 {
        let Some(x) = owner.and_then(|o| o.get(v)) else { return 0.0 };
        let d = pop.get(v).copied().unwrap_or(Spread { mean_bps: 5_000, sd_bps: 1_500 });
        ((*x - d.mean_bps) as f64 / d.sd_bps.max(1) as f64).clamp(-3.0, 3.0)
    };
    Character {
        keep_trading: (z("security") + z("tradition")) / 2.0,
        grow: (z("achievement") + z("stimulation") + z("power")) / 3.0,
        keep: (z("benevolence") + z("conformity")) / 2.0,
        be_rid: (z("power") - z("benevolence")) / 2.0,
        pay_less: (z("power") + z("achievement") - z("universalism") - z("benevolence")) / 4.0,
        standing: (z("conformity") + z("benevolence") + z("universalism")) / 3.0,
    }
}

/// `Math.round`: half up.
fn round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

/// A rate swayed by where an organisation stands against its town: `z` standard deviations from the mean (held to
/// three), `per` the share of the rate a standard deviation moves it. Symmetric, so the town's rate stays calibrated.
pub fn swayed(bps: i64, z: f64, per: f64) -> i64 {
    round(bps as f64 * (1.0 + per * z.clamp(-3.0, 3.0))).clamp(0, 10_000)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgParams {
    /// Asked to hold a rent it has given notice of raising, to give a rise, to let a tenant under notice stay: how
    /// often an organisation of the town's mean character says yes. PLACEHOLDERS: a place's own figure is its profile's
    /// (`outlook.asked`: docs/profiles.md), given by the world.
    pub hold_bps: i64,
    pub rise_bps: i64,
    pub stay_bps: i64,
    /// How far a standard deviation of character sways those answers (a share of the rate). PLACEHOLDER.
    pub answer: f64,
    /// How far it sways a markup or a margin; and by how many months, a standard deviation, its patience with someone
    /// who owes it. PLACEHOLDERS.
    pub markup: f64,
    pub patience_months: f64,
    /// A rise is given only if what is in the bank covers this many pay periods of the new wage bill. PLACEHOLDER.
    pub rise_cover_periods: i64,
    /// The wants' own figures (`mind::wants::want_params` reads them).
    pub wants: Value,
}

impl Default for OrgParams {
    fn default() -> Self {
        OrgParams { hold_bps: 3_000, rise_bps: 3_000, stay_bps: 3_000, answer: 0.5, markup: 0.3, patience_months: 0.5, rise_cover_periods: 3, wants: json!({}) }
    }
}

impl OrgParams {
    /// The defaults with the world's keys over them (`org` of a module's parameters). A key of the wrong type is ignored.
    pub fn from_json(given: &Value) -> OrgParams {
        let mut p = OrgParams::default();
        let int = |k: &str| given.get(k).and_then(Value::as_i64);
        let num = |k: &str| given.get(k).and_then(Value::as_f64);
        p.hold_bps = int("hold_bps").unwrap_or(p.hold_bps);
        p.rise_bps = int("rise_bps").unwrap_or(p.rise_bps);
        p.stay_bps = int("stay_bps").unwrap_or(p.stay_bps);
        p.rise_cover_periods = int("rise_cover_periods").unwrap_or(p.rise_cover_periods);
        p.answer = num("answer").unwrap_or(p.answer);
        p.markup = num("markup").unwrap_or(p.markup);
        p.patience_months = num("patience_months").unwrap_or(p.patience_months);
        if let Some(w) = given.get("wants").filter(|w| w.is_object()) {
            p.wants = w.clone();
        }
        p
    }
}

/// What became of one of an organisation's wants, as `Org` records it (A2's `WantEvent`, to the three things read).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WantNote {
    pub t: i64,
    /// born, pursued, met, given_up, grown, displaced.
    pub kind: String,
    pub about: String,
    pub weight: i64,
    pub way: Option<String>,
}

/// The wants book as an organisation reads it: the events since last asked, and its record section.
pub trait Wanting {
    fn take_events(&mut self) -> Vec<WantNote>;
    fn section(&self) -> Value;
}

/// A small wants book for tests and for an organisation with none yet: it has no wants and says so.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NoWants {
    pub events: Vec<WantNote>,
}

impl Wanting for NoWants {
    fn take_events(&mut self) -> Vec<WantNote> {
        std::mem::take(&mut self.events)
    }
    fn section(&self) -> Value {
        json!([])
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Noted {
    t: i64,
    what: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    about: Option<String>,
    size: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    by: Option<String>,
}

/// What an organisation is given when it is made.
#[derive(Debug, Clone, Default)]
pub struct Given {
    /// Its habit as the record has it.
    pub practice: Vec<PracticeRow>,
    /// Whether it takes initiative: absent, its own draw against the world's dial.
    pub initiative: Option<bool>,
    pub owner_values: Option<BTreeMap<String, i64>>,
    pub values: BTreeMap<String, Spread>,
    pub org: Option<Value>,
    /// The culture dial's practice figures, where the dial is on (docs/behaviour/culture.md, "An office's practice").
    pub culture: Option<PracticeParams>,
}

/// The change to its record since it was last written (contracts/entity-record.schema.json, OrganisationRecord).
#[derive(Debug, Clone, PartialEq)]
pub struct RecordChange {
    pub set: Map<String, Value>,
    pub because: Vec<Value>,
}

impl RecordChange {
    /// As `Cx::set_record` takes it: `{ set, because? }`.
    pub fn json(&self) -> Value {
        let mut m = Map::new();
        m.insert("set".into(), Value::Object(self.set.clone()));
        if !self.because.is_empty() {
            m.insert("because".into(), Value::Array(self.because.clone()));
        }
        Value::Object(m)
    }
}

/// An organisation's wants and character, for the module that runs its post. `lively`: whether it takes initiative
/// (its own draw against the world's dial, or as the world says); where it does not, every lever reads as the routine
/// has it and it answers nothing, so the organisation is the one it was before wants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(bound = "W: Serialize + DeserializeOwned")]
pub struct Org<W> {
    pub lively: bool,
    pub character: Character,
    pub wants: W,
    pub p: OrgParams,
    /// Its habit, where the culture dial is on and it takes initiative; absent otherwise.
    pub practice: Option<Practice>,
    recent: VecDeque<Noted>,
    since: Vec<Noted>,
    written: String,
    counts: BTreeMap<String, i64>,
    told: Vec<WantNote>,
}

impl<W: Wanting + Serialize + DeserializeOwned> Org<W> {
    /// `wants`: the book of wants, made by the caller from `p.wants`.
    pub fn new(cx: &mut Cx, given: Given, wants: W) -> Org<W> {
        let dial = cx.ctx.world.dials.get("initiative_bps").and_then(Value::as_i64).unwrap_or(0);
        let lively = match given.initiative {
            Some(x) => x,
            None => dial > 0 && cx.rng("initiative").below(10_000) < dial as u64,
        };
        let character = if lively { character_of(given.owner_values.as_ref(), &given.values) } else { Character::default() };
        let p = given.org.as_ref().map_or_else(OrgParams::default, OrgParams::from_json);
        let mut org = Org { lively, character, wants, p, practice: None, recent: VecDeque::new(), since: vec![], written: String::new(), counts: BTreeMap::new(), told: vec![] };
        if let (true, Some(params)) = (lively, given.culture) {
            let mut practice = Practice::new(params, &given.practice);
            // (An office is never new on day 1: it opens with the habit its character gives, so at the opening nothing moves.)
            for k in PRACTICES {
                practice.open(k, org.chance_of(k, 0.0), 0);
            }
            org.practice = Some(practice);
        }
        org
    }

    fn chance_of(&self, what: PracticeOf, worth: f64) -> i64 {
        let c = &self.character;
        let against = match what {
            PracticeOf::Rise => c.pay_less,
            PracticeOf::Stay => c.be_rid,
            PracticeOf::Hold => c.grow,
        };
        let lean = (c.keep + c.standing) / 2.0 - against + worth;
        let base = match what {
            PracticeOf::Hold => self.p.hold_bps,
            PracticeOf::Rise => self.p.rise_bps,
            PracticeOf::Stay => self.p.stay_bps,
        };
        swayed(base, lean, self.p.answer)
    }

    /// Asked something by someone it deals with: yes or no, by its character and the draw it is handed. `worth`: how
    /// much the one asking is worth keeping, in standard deviations (a tenant who always paid, a hand long with us).
    /// Holding a rent or letting a tenant stay sets keeping them and being thought well of against growing; a rise
    /// sets them against paying less.
    pub fn grants(&mut self, what: PracticeOf, rng: &mut Rng, worth: f64, t: i64) -> (bool, i64) {
        let mut chance = self.chance_of(what, worth);
        // (Its habit, where the culture dial is on: the rate is drawn part of the way from what its character gives
        // toward what the office has in fact done. No draw is added.)
        if let Some(practice) = &self.practice {
            chance = practice.pulled(what, chance, self.chance_of(what, 0.0));
        }
        let granted = self.lively && rng.below(10_000) < chance as u64;
        if let Some(practice) = &mut self.practice {
            practice.observe(what, t, granted);
        }
        self.count(if granted { "granted" } else { "refused" }, 1);
        (granted, chance)
    }

    /// A markup or margin of its routine, as its character sways it: more for one that would grow, less for one that
    /// would keep those it deals with. Symmetric about the town's mean, so the town's rents and prices stay put.
    pub fn markup(&self, bps: i64) -> i64 {
        if self.lively {
            swayed(bps, self.character.grow - self.character.keep, self.p.markup)
        } else {
            bps
        }
    }

    /// How many months it bears with someone who owes it before acting: longer for one that would keep them. Never
    /// shorter than its routine's: under that, its own books cannot tell a payment a few days late from one not made,
    /// so one that would be rid of a tenant acts when the routine does. (So this lever only lengthens.)
    pub fn patience(&self, months: f64) -> f64 {
        if self.lively {
            months.max(months + round(self.p.patience_months * (self.character.keep - self.character.be_rid)) as f64)
        } else {
            months
        }
    }

    /// Something happened to it (for its record's memory and reasons).
    pub fn remember(&mut self, t: i64, what: &str, about: Option<&str>, size: i64) {
        let r = Noted { t, what: what.into(), about: about.map(String::from), size, by: None };
        self.recent.push_back(r.clone());
        if self.recent.len() > 8 {
            self.recent.pop_front();
        }
        self.noted(r);
    }

    fn noted(&mut self, r: Noted) {
        self.since.push(r);
        if self.since.len() > 16 {
            self.since.remove(0);
        }
    }

    pub fn count(&mut self, what: &str, n: i64) {
        *self.counts.entry(what.to_string()).or_insert(0) += n;
    }

    /// What has become of its wants since last asked (for whoever records outcomes).
    pub fn take_want_events(&mut self) -> Vec<WantNote> {
        std::mem::take(&mut self.told)
    }

    /// The change to its record since it was last written, if any.
    pub fn change(&mut self, circumstances: &BTreeMap<String, i64>) -> Option<RecordChange> {
        if !self.lively {
            return None;
        }
        for e in self.wants.take_events() {
            let by = match (&e.way, e.kind.as_str()) {
                (Some(w), "pursued") if !w.is_empty() => Some(if w.starts_with("offer:") { w.clone() } else { w.split(':').next().unwrap_or("").to_string() }),
                _ => None,
            };
            let r = Noted { t: e.t, what: format!("want_{}", e.kind), about: Some(e.about.clone()), size: e.weight, by };
            self.told.push(e);
            self.noted(r);
        }
        let bps = |z: f64| round(5_000.0 + 1_000.0 * z).clamp(0, 10_000);
        let mut counts: BTreeMap<String, i64> = self.counts.clone();
        counts.extend(circumstances.iter().map(|(k, v)| (k.clone(), *v)));
        let mut all = Map::new();
        all.insert("character".into(), Value::Object(ORG_WANTS.iter().map(|w| (w.to_string(), json!(bps(self.character.get(w))))).collect()));
        all.insert("wants".into(), self.wants.section());
        all.insert("memory".into(), json!({ "recent": self.recent }));
        if let Some(p) = &self.practice {
            all.insert("practice".into(), json!(p.section()));
        }
        all.insert("circumstances".into(), json!(counts));
        let text = Value::Object(all.clone()).to_string();
        if text == self.written {
            return None;
        }
        let before: Value = if self.written.is_empty() { json!({}) } else { serde_json::from_str(&self.written).unwrap_or(json!({})) };
        let set: Map<String, Value> = all.into_iter().filter(|(k, v)| before.get(k) != Some(v)).collect();
        self.written = text;
        let because = std::mem::take(&mut self.since).into_iter().map(|n| json!(n)).collect();
        Some(RecordChange { set, because })
    }

    /// The wrapper `keeping` was: at the act that ends a wake, the organisation's record change (one a wake), where it
    /// takes initiative and there is a change to write.
    pub fn keep(&mut self, cx: &mut Cx, circumstances: &BTreeMap<String, i64>) {
        if let Some(c) = self.change(circumstances) {
            cx.set_record(c.json());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ctx, Draws, WorldInfo};
    use oikos_rules::slip::Performer;
    use std::sync::Arc;

    const VALUES: [&str; 10] = ["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"];

    fn values(hi: &[&str], lo: &[&str]) -> BTreeMap<String, i64> {
        VALUES.iter().map(|v| (v.to_string(), if hi.contains(v) { 9_500 } else if lo.contains(v) { 500 } else { 5_000 })).collect()
    }
    fn kind() -> BTreeMap<String, i64> {
        values(&["benevolence", "conformity", "universalism"], &["power", "achievement", "stimulation"])
    }
    fn hard() -> BTreeMap<String, i64> {
        values(&["power", "achievement", "stimulation"], &["benevolence", "conformity", "universalism"])
    }
    fn ctx(dial: i64) -> Ctx {
        Ctx {
            participant: "shop-1-manager-system".into(),
            performer: Performer::default(),
            entity: "shop-1".into(),
            position: None,
            params: Map::new(),
            world: Arc::new(WorldInfo { dials: json!({ "initiative_bps": dial }), ..Default::default() }),
        }
    }
    const CULTURE: PracticeParams = PracticeParams { window_days: 1_825, min_occasions: 5, inertia_bps: 5_000, opening: 100 };
    fn org(culture: bool, owner: Option<BTreeMap<String, i64>>) -> Org<NoWants> {
        let c = ctx(10_000);
        let mut draws = Draws::default();
        let mut cx = Cx::new(0, &c, &mut draws, 7, vec![]);
        Org::new(&mut cx, Given { initiative: Some(true), owner_values: owner, culture: culture.then_some(CULTURE), ..Default::default() }, NoWants::default())
    }
    fn rng() -> Rng {
        oikos_core::rng::Randomness::new(7).stream(&["practice"])
    }

    #[test]
    fn character_follows_the_owners_values_about_the_towns_mean() {
        let (k, h) = (character_of(Some(&kind()), &BTreeMap::new()), character_of(Some(&hard()), &BTreeMap::new()));
        assert!(k.keep > 0.0 && k.standing > 0.0 && k.pay_less < 0.0 && k.grow < 0.0);
        for w in ORG_WANTS {
            assert!((h.get(w) + k.get(w)).abs() < 1e-9, "{w}");
        }
        assert_eq!(character_of(None, &BTreeMap::new()), Character::default());
    }

    #[test]
    fn an_office_opens_with_a_past_at_the_rate_its_character_gives_so_at_the_opening_nothing_moves() {
        let mut o = org(true, Some(kind()));
        let rows = o.practice.as_ref().unwrap().section();
        assert_eq!(rows.iter().map(|r| r.of).collect::<Vec<_>>(), PRACTICES);
        assert!(rows.iter().all(|r| r.occasions == CULTURE.opening));
        let mut off = org(false, Some(kind()));
        for worth in [-1.0, 0.0, 0.5] {
            for k in PRACTICES {
                let (a, b) = (o.grants(k, &mut rng(), worth, 0).1, off.grants(k, &mut rng(), worth, 0).1);
                assert!((a - b).abs() <= 30, "{k:?} {worth}: the rounding of a whole number of occasions");
            }
        }
    }

    #[test]
    fn with_the_dial_off_an_organisation_has_no_practice() {
        let mut o = org(false, Some(kind()));
        assert!(o.practice.is_none());
        assert!(o.change(&BTreeMap::new()).unwrap().set.get("practice").is_none());
    }

    #[test]
    fn a_habit_moves_a_code_holders_answers() {
        let (mut yes, mut no) = (org(true, Some(kind())), org(true, Some(kind())));
        for i in 0..60 {
            yes.practice.as_mut().unwrap().observe(PracticeOf::Stay, i * 86_400, true);
            no.practice.as_mut().unwrap().observe(PracticeOf::Stay, i * 86_400, false);
        }
        assert!(yes.grants(PracticeOf::Stay, &mut rng(), 0.0, 70 * 86_400).1 > no.grants(PracticeOf::Stay, &mut rng(), 0.0, 70 * 86_400).1);
    }

    #[test]
    fn practice_persists_across_holders_through_the_record_and_the_organisation_saves() {
        let mut first = org(true, Some(kind()));
        for i in 0..40 {
            first.practice.as_mut().unwrap().observe(PracticeOf::Rise, i * 86_400, i % 2 == 0);
        }
        let change = first.change(&BTreeMap::new()).unwrap();
        let written: Vec<PracticeRow> = serde_json::from_value(change.set["practice"].clone()).unwrap();
        assert_eq!(written.iter().find(|r| r.of == PracticeOf::Rise).unwrap().occasions, CULTURE.opening + 40);
        let c = ctx(10_000);
        let mut draws = Draws::default();
        let mut cx = Cx::new(0, &c, &mut draws, 7, vec![]);
        let next = Org::new(&mut cx, Given { initiative: Some(true), owner_values: Some(kind()), culture: Some(CULTURE), practice: written.clone(), ..Default::default() }, NoWants::default());
        assert_eq!(next.practice.unwrap().section(), written);
        // Nothing changed since: no second change; and a saved organisation comes back as it was.
        assert!(first.change(&BTreeMap::new()).is_none());
        let back: Org<NoWants> = serde_json::from_value(serde_json::to_value(&first).unwrap()).unwrap();
        assert!(back.practice == first.practice && back.character == first.character);
    }

    #[test]
    fn the_two_owners_answer_differently_and_a_record_says_what_happened() {
        let (mut kind_org, mut hard_org) = (org(false, Some(kind())), org(false, Some(hard())));
        // Rates differ in the direction character gives.
        let chance = |o: &mut Org<NoWants>| o.grants(PracticeOf::Hold, &mut rng(), 0.0, 0).1;
        assert!(chance(&mut kind_org) > 3_000 && chance(&mut hard_org) < 3_000);
        assert!(kind_org.markup(1_000) < 1_000 && hard_org.markup(1_000) > 1_000);
        assert!(kind_org.patience(2.0) >= 2.0);
        kind_org.remember(5, "held_rent", Some("ann"), 1_000);
        let c = kind_org.change(&BTreeMap::from([("homes".to_string(), 2)])).unwrap();
        assert!(c.set["character"]["keep"].as_i64().unwrap() > 5_000);
        assert_eq!(c.set["memory"]["recent"][0]["what"], "held_rent");
        assert_eq!(c.set["circumstances"]["homes"], 2);
        // One that takes no initiative answers nothing and writes no record.
        let mut plain = Org::new(&mut Cx::new(0, &ctx(0), &mut Draws::default(), 7, vec![]), Given::default(), NoWants::default());
        assert!(!plain.lively && plain.change(&BTreeMap::new()).is_none());
        assert!(!plain.grants(PracticeOf::Hold, &mut rng(), 0.0, 0).0);
        assert_eq!(plain.markup(1_234), 1_234);
    }
}
