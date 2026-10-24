//! The citizen's parameters (citizen.ts `create`, its `params(...)` table): names and meanings unchanged, so profiles
//! and configs keep working (docs/port-guide.md, section 2). Every default is the TS one. Place figures come from the
//! world's profile; those here are the module's placeholders (docs/profiles.md), named as such in
//! docs/behaviour/citizen.md.
//!
//! What only the mind reads (values, own_values, outlook, inner, institutions, initiative, wants, founding, job_move,
//! mind, sway, beliefs, belief, goals, culture's origin) is not typed here: the mind reads `ctx.params` itself (lane A2).

use serde::{Deserialize, Serialize};
use serde_json::Value;

const DAY: i64 = 86_400;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Params {
    pub year: i64,
    pub births: bool,
    pub gestation: i64,
    pub rent_share_bps: i64,
    pub rent_bearable_share_bps: i64,
    pub savings_rent_months: i64,
    pub essentials: i64,
    pub saving_bps: i64,
    pub wealth_effect_bps_per_year: i64,
    pub income_window_days: i64,
    pub buffer_months: i64,
    pub retirement_age: Option<i64>,
    /// An age, or "never" (`StopsWork`).
    pub stops_work_at: Option<Value>,
    pub stop_work_curve: Option<Vec<FromBps>>,
    pub own_work: Option<OwnWork>,
    pub in_labour_force: bool,
    pub child_template: String,
    pub child_template_outside_lf: String,
    pub participation_bps: i64,
    pub ventures: Vec<Venture>,
    pub found_own_buffer_months: i64,
    /// The trade they worked in as the year began (the industry of their job then), which an application of theirs
    /// names until they have worked elsewhere (docs/design/market-realism.md, ME-2).
    pub trade: Option<String>,
    pub give_up_months: i64,
    pub give_up_below_bps: i64,
    pub possession: Option<Possession>,
    pub shop_every_days: i64,
    pub beta: i64,
    pub adverts: String,
    pub shop_search_bps: i64,
    pub shops_known: i64,
    pub sale_board: String,
    pub frictions: Frictions,
    /// What a person keeps of public goings-on (citizen/memory.rs; risk SC-1). None: everything, for good.
    pub public_memory: Option<super::memory::PublicMemory>,
    pub started: Option<Started>,
    pub essentials_units: i64,
    pub goods: String,
    /// How a household divides its spending among the kinds on offer (the linear expenditure system: the profile's
    /// household expenditure survey; `oikos_rules::demand`, docs/behaviour/demand.md). None: the one kind, `goods`.
    pub demand: Option<Demand>,
    pub leave_after_homeless_days: i64,
    pub stay: Stay,
    pub leave_after_jobless_days: i64,
    pub electoral_town: Option<String>,
    pub electoral_body: Option<String>,
    pub paper: Option<String>,
    pub school: Option<School>,
    pub tell_on_leaving: Vec<String>,
    pub welfare: Option<Welfare>,
    pub care: Option<Care>,
    pub tribunal: Option<Tribunal>,
    pub utilities: Option<Utilities>,
    pub round: Option<Round>,
    pub relief: Option<String>,
    pub crime: Option<Crime>,
    pub register: Option<Register>,
    pub work_board: Option<String>,
    pub market: Option<Market>,
    pub civic: Civic,
    pub petition_start_bps: i64,
    pub petition_willing_bps: i64,
    pub petition_days: i64,
    pub tenancy_schedule: String,
    pub threshold_mean_bps: i64,
    pub threshold_sd_bps: i64,
    pub population: i64,
    pub rent_burden_grievance_bps: i64,
    pub aggrieved_bps: i64,
    pub search_limit: u32,
    pub ask_home_bps: i64,
    pub ask_work_bps: i64,
    pub ask_again_days: i64,
    pub max_contacts: usize,
    pub pass_on_bps: i64,
    pub catch_up_days: i64,
    pub news_days: i64,
    pub accept_fewer_bedrooms_after_days: i64,
    pub occupancy: Option<oikos_rules::household::OccupancyStandard>,
    pub fertility_per_10000: Vec<FromRate>,
    pub complain_to: Option<String>,
    pub complain_about: String,
    pub complain_after_days: i64,
    pub complain_bps: i64,
    pub union: Option<String>,
    pub union_join_bps: std::collections::BTreeMap<String, i64>,
    pub ballot_turnout_bps: i64,
    pub strike_vote_yes_bps: i64,
    // ---- whom we deal with (no defaults: the world says)
    pub bank: Option<String>,
    pub outside_account: Option<String>,
    pub registry: Option<String>,
    pub child_protection: Option<String>,
    /// Support take-up (docs/behaviour/citizen.md, "Claiming support"; risks A-30): the share of those entitled to a
    /// payment who claim it, where the world's profile gives one. None: everyone entitled claims, as before.
    pub take_up_bps: Option<i64>,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            year: 365 * DAY,
            births: false,
            gestation: 266 * DAY,
            rent_share_bps: 3_300,
            rent_bearable_share_bps: 5_000,
            savings_rent_months: 6,
            essentials: 40_000,
            saving_bps: 500,
            wealth_effect_bps_per_year: 300,
            income_window_days: 90,
            buffer_months: 3,
            retirement_age: None,
            stops_work_at: None,
            stop_work_curve: None,
            own_work: None,
            in_labour_force: true,
            child_template: "child".into(),
            child_template_outside_lf: String::new(),
            participation_bps: 10_000,
            ventures: vec![],
            found_own_buffer_months: 1,
            trade: None,
            give_up_months: 6,
            give_up_below_bps: 5_000,
            possession: None,
            shop_every_days: 14,
            beta: 5,
            adverts: String::new(),
            shop_search_bps: 2_500,
            shops_known: 7,
            sale_board: String::new(),
            frictions: Frictions::default(),
            public_memory: None,
            started: None,
            essentials_units: 10,
            goods: "goods".into(),
            demand: None,
            leave_after_homeless_days: 90,
            stay: Stay::default(),
            leave_after_jobless_days: 180,
            electoral_town: None,
            electoral_body: None,
            paper: None,
            school: None,
            tell_on_leaving: vec![],
            welfare: None,
            care: None,
            tribunal: None,
            utilities: None,
            round: None,
            relief: None,
            crime: None,
            register: None,
            work_board: None,
            market: None,
            civic: Civic::default(),
            petition_start_bps: 300,
            petition_willing_bps: 4_400,
            petition_days: 180,
            tenancy_schedule: String::new(),
            threshold_mean_bps: 2_500,
            threshold_sd_bps: 1_000,
            population: 200,
            rent_burden_grievance_bps: 4_000,
            aggrieved_bps: 2_000,
            search_limit: 20,
            ask_home_bps: 3_700,
            ask_work_bps: 6_900,
            ask_again_days: 60,
            max_contacts: 15,
            pass_on_bps: 10_000,
            catch_up_days: 14,
            news_days: 90,
            accept_fewer_bedrooms_after_days: 60,
            occupancy: None,
            fertility_per_10000: vec![],
            complain_to: None,
            complain_about: "waste".into(),
            complain_after_days: 14,
            complain_bps: 3_000,
            union: None,
            union_join_bps: Default::default(),
            ballot_turnout_bps: 7_000,
            strike_vote_yes_bps: 8_500,
            bank: None,
            outside_account: None,
            registry: None,
            child_protection: None,
            take_up_bps: None,
        }
    }
}

impl Params {
    /// The parameters as the world gives them (a role's with the person's own on top, as the engine composes them).
    pub fn of(params: &serde_json::Map<String, Value>) -> Result<Params, String> {
        // (A null is "the module's default", as TS's `params` read it: dropped before reading.)
        let given: serde_json::Map<String, Value> = params.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
        serde_json::from_value(Value::Object(given)).map_err(|e| format!("citizen.default's parameters: {e}"))
    }
    /// The age at which this person stops work (none: never), from their own (`stops_work_at`), the world's curve
    /// (drawn once, `q` of 10,000), or the world's one age.
    pub fn stop_age(&self, q: i64) -> Option<i64> {
        match &self.stops_work_at {
            Some(Value::String(s)) if s == "never" => None,
            Some(v) if v.as_i64().is_some() => v.as_i64(),
            _ => match &self.stop_work_curve {
                Some(curve) => stops_work_at(curve, q),
                None => self.retirement_age,
            },
        }
    }
}

/// payments.ts `stopsWorkAt`: the age at which someone at quantile `q` (of 10,000) leaves the labour force, read from
/// the share in it by age (each band's share of those in it at the band before: the first band whose share falls
/// below `q`'s place). None: they never stop.
pub fn stops_work_at(curve: &[FromBps], q: i64) -> Option<i64> {
    let base = curve.first()?.bps;
    if base <= 0 {
        return curve.first().map(|b| b.from);
    }
    // (A share that rises again with age brings nobody back: the share kept only falls.)
    let mut kept = 10_000;
    for b in &curve[1..] {
        kept = kept.min(b.bps * 10_000 / base);
        if q >= kept {
            return Some(b.from);
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FromBps {
    pub from: i64,
    pub bps: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FromRate {
    pub from: i64,
    pub rate: i64,
}

/// A business we run alone (docs/behaviour/entry.md, "A person working for themself").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnWork {
    pub firm: String,
    pub account: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    pub expect_per_month: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Venture {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub capital: i64,
    #[serde(default)]
    pub channels: Vec<Value>,
    pub role_module: Value,
    #[serde(default)]
    pub own: bool,
    #[serde(default)]
    pub expect_per_month: Option<i64>,
    /// The trade price its goods are bought in at, as the world publishes it (for a founder who holds no trade price
    /// list: docs/behaviour/entry.md, "Entry by expected profit").
    #[serde(default)]
    pub unit_cost: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Possession {
    pub stay_bps: i64,
    pub obey_bps: i64,
    #[serde(default)]
    pub answer_bps: Option<i64>,
    #[serde(default)]
    pub notice_days: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frictions {
    #[serde(default)]
    pub disrepair: Option<Disrepair>,
    #[serde(default)]
    pub bill_over_bps: Option<i64>,
    #[serde(default)]
    pub answer_days: Option<i64>,
    #[serde(default)]
    pub promise_days: Option<i64>,
    #[serde(default)]
    pub faulty_bps_per_year: Option<i64>,
    #[serde(default)]
    pub faulty_share_bps: Option<i64>,
    /// The rate a year at which what is bought of another kind than goods is found faulty (basis points of the custom
    /// a year), by kind: the place's, kind by kind (docs/behaviour/frictions.md).
    #[serde(default)]
    pub faulty_by_kind: std::collections::BTreeMap<String, i64>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Disrepair {
    pub variable: String,
    pub at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Started {
    #[serde(default)]
    pub place_days: Option<i64>,
    #[serde(default)]
    pub trade_days: Option<i64>,
    #[serde(default)]
    pub group_days: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stay {
    pub ask: usize,
    pub ask_again_days: i64,
    pub willing_affinity_bps: i64,
}
impl Default for Stay {
    fn default() -> Self {
        Stay { ask: 5, ask_again_days: 30, willing_affinity_bps: 1_500 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct School {
    pub entity: String,
    pub building: String,
    pub ages: [i64; 2],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Welfare {
    pub police: String,
    pub channel: String,
    pub found_after: Vec<WithinBps>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WithinBps {
    pub within_days: i64,
    pub bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Care {
    pub entity: String,
    pub waiting: String,
    pub seek_bps: i64,
    pub severities: Vec<String>,
    pub off_work: Vec<String>,
    pub wait_days: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tribunal {
    pub entity: String,
    pub challenge_bps: i64,
    pub apply_bps: i64,
    pub apply_after_days: i64,
    #[serde(default)]
    pub hears: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Utilities {
    pub energy: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Round {
    pub work_start: i64,
    pub work_end: i64,
    pub work_days: i64,
    pub school_start: i64,
    pub school_end: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Crime {
    pub take_bps: i64,
    pub caught_bps: i64,
    pub quantity: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Register {
    pub lots: String,
    pub titles: String,
    pub dealings: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Market {
    pub buy_bps: i64,
    pub deposit_bps: i64,
    pub costs_bps: i64,
    pub mortgage_months: i64,
    pub bedrooms_by_type: std::collections::BTreeMap<String, i64>,
    pub relist_days: i64,
    pub cut_bps: i64,
    pub floor_bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// The household demand system's figures (the generator writes them from the profile's `spending.demand`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Demand {
    /// Each kind the survey describes: its average budget share and its income elasticity.
    pub kinds: Vec<oikos_rules::demand::Survey>,
    /// Frisch's money flexibility (negative basis points).
    pub frisch_bps: i64,
    /// A spender's mean month of spending in the town at the start (cents): where the survey's shares hold.
    pub reference_budget: i64,
    /// Each kind's price at the start (cents a unit): where the survey's shares hold.
    pub reference_prices: std::collections::BTreeMap<String, i64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_generated_citizens_parameters_read_and_unknown_ones_are_left_to_the_mind() {
        let v = json!({ "bank": "bank", "essentials": 41000, "values": { "values": {} }, "retirement_age": 67, "own_values": null,
            "stop_work_curve": [{ "from": 25, "bps": 8700 }, { "from": 55, "bps": 7752 }, { "from": 65, "bps": 1613 }],
            "school": { "entity": "school", "building": "b", "ages": [5, 17] } });
        let p = Params::of(v.as_object().unwrap()).unwrap();
        assert_eq!((p.essentials, p.bank.as_deref(), p.shop_every_days), (41_000, Some("bank"), 14));
        // (The curve: 7752/8700 = 8910 of 10,000 are still in at 55, 1613/8700 = 1854 at 65; a draw at or over the
        // share kept has stopped by then.)
        assert_eq!(p.stop_age(9_500), Some(55));
        assert_eq!(p.stop_age(5_000), Some(65));
        assert_eq!(p.stop_age(1_000), None, "below every band's share: never stops");
        let mut never = v.as_object().unwrap().clone();
        never.insert("stops_work_at".into(), json!("never"));
        assert_eq!(Params::of(&never).unwrap().stop_age(9_500), None);
    }
}
