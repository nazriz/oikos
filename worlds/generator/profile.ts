// A profile: every place-specific figure a generator uses, with its source (docs/profiles.md). The generator's code is
// the same for every place; a world for another place and time is another profile.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Currency, HouseholdSpec } from "@oikos/participants";

export interface Profile {
  id: string;
  place: string;
  as_of: string;
  about?: string;
  values: {
    /** The place's money, as the world config declares it (contracts: world.currencies): its code and decimal places,
     * and how people write it (its sign, the words for its unit and its smallest unit). */
    currency: Currency;
    households: HouseholdSpec;
    fertility_per_10000: { from: number; rate: number }[];
    life: {
      qx_per_100000: { male: number[]; female: number[] };
      illness: unknown;
      injury: unknown;
      birth: { ages: [number, number]; gestation_days: number; female_bps: number };
      work_injury_bps: { factory: number; shop: number };
      /** How long after dying at home with nobody there a person is found: the share of such deaths found within so many
       * days, band by band (docs/behaviour/deaths.md). */
      found_alone_after?: { within_days: number; bps: number }[];
      /** Deaths care could prevent: the share of each age's deaths that's treatable, carried by an illness band. */
      treatable?: { share_bps_by_age: { from: number; bps: number }[]; band: string };
    };
    /** The working week a full-time wage is pay for, in hours: what people here work, not a legal ceiling above it. The
     * generator spreads it over the days of the week people work, and reckons an hour's pay from it. */
    ordinary_hours_per_week: number;
    /** How often wages are paid here, in days (14, 30...). */
    pay_period_days: number;
    /** A full-time wage by kind of work, gross, for one pay period. */
    wages_per_pay_period: { shop: number; factory: number; construction: number };
    rents_per_month: {
      apartment_units: { bedrooms: number; count: number; rent: number }[];
      house_types: { id: string; bedrooms: number; share_bps: number; rent: number }[];
    };
    spending: { saving_bps: number; wealth_effect_bps_per_year: number; essentials_per_month: number; shops_known: number; shop_search_bps_per_month: number };
    /** An adult's savings (cash and deposits), by age: percentiles 10, 25, 50, 75, 90 (cents). */
    savings_by_age?: { from: number; pct: [number, number, number, number, number] }[];
    retirement_age: number;
    labour_force_participation_bps: number;
    /** Tenancy law. A place with no rule on how often a rent may rise or on what notice leaves both figures out (no
     * such law is written); landlords then review rents as often as `rent_review_practice_months` says, if it's given. */
    tenancy: { rent_review_months?: number; rent_increase_notice_days?: number; rent_review_practice_months?: number; after_fixed_term?: "periodic" };
    values: { [value: string]: { mean_bps: number; sd_bps: number } };
    /** The law on industrial action. A place that requires no ballot leaves both ballot figures out; one that requires
     * no notice either leaves that out too (and no such law is written). */
    industrial_action: { ballot_turnout_bps?: number; ballot_pass_bps?: number; notice_days?: number; paid_during_action: boolean };
    world_price_process: { [kind: string]: { sd_bps: number; persistence_bps: number } };
    credit: {
      cash_rate_bps: number; funding_spread_bps: number; lending_rate_bps: { person: number; organisation: number };
      /** What lenders add to their rate when assessing whether a loan can be repaid. Left out where they add nothing. */
      serviceability_buffer_bps?: number;
      max_repayment_share_bps: { person: number; organisation: number }; arrears_days: number; default_days: number; max_months: number;
      /** The cash the bank's lending office keeps back. */
      reserve: number;
    };
    /** What each organisation holds on the first day, and the least an adult in the labour force has saved. (A shop's
     * and a factory's opening money isn't stated: the generator works out their working capital.) */
    opening: { bank: number; town: number; builder: number; landlord: number; person_min_savings: number };
    /** The town's own money rules: its yearly parks line, and the payment its procedure needs the mayor's approval over. */
    town_finance: { parks_per_year: number; payment_approval_over: number };
    retiree_savings: [number, number];
    /** Support paid from outside the town. A place with no payment to the unemployed leaves `unemployment` out. */
    support: { pension: { amount: number; every_days: number; from_age: number }; unemployment?: { amount: number; every_days: number; from_age: number } };
    /** Who owns firms (docs/behaviour/firm-ownership.md). Fifths are of households by wealth, lowest first. */
    firm_ownership: {
      /** Of the firms of each kind, the share held each way: by one household or a few; from outside; widely. */
      forms_bps: { [kind in "factory" | "shop" | "landlord"]: { closely_held: number; outside: number; widely_held: number } };
      /** A closely held firm: the shares with one, two, three... owning households; the weight of each fifth in who owns. */
      closely_held: { households_bps: number[]; owner_wealth_fifth_bps: [number, number, number, number, number] };
      /** A widely held firm: the part held from outside; the rest is the town's (its direct holders'; where a world has a
       * retirement fund, the fund's share of it first). */
      widely_held: { outside_bps: number };
      /** Households holding shares directly: the share of each fifth that does, and how many firms one holds (a range). */
      direct_holders: { by_wealth_fifth_bps: [number, number, number, number, number]; firms_held: [number, number] };
    };
    /** A retirement fund's figures, for a world that asks for one (the town's description: retirement_fund; off unless
     * asked for, docs/behaviour/firm-ownership.md): its share of the town's part of a widely held firm, the share of
     * adults who are members, how often it pays pensions, the least it pays of a balance a year by age, its costs as a
     * share of what it takes in. */
    retirement_fund?: { share_bps_of_local: number; member_bps: number; pension_every_days: number; drawdown_bps_by_age: { from: number; bps: number }[]; cost_bps_of_income: number };
    industry: { factory_labour_share_bps: number; factory_input_share_bps: number; retail_purchases_share_bps: number; retail_labour_share_bps: number };
    /** Prices at the world market. `goods_world` is the price of an item of goods, the town's own unit and no real
     * thing's price: left out, the generator derives it (an item is a fixed amount of factory work); stated, it fixes
     * the unit, and the generator checks it's a size the world's whole numbers can carry (docs/profiles.md). */
    prices: { goods_world?: number; goods_import_markup_bps: number; inputs_per_kg: number; materials_per_kg: number };
    public_finance: {
      income_tax: { brackets: { from: number; rate_bps: number }[]; levy_bps: number; levy_from: number };
      grants_per_resident_per_year: number;
      rates_per_resident_per_year: number;
      rates_instalments: number;
      rates_due_days: number;
      rates_penalty_interest_bps: number;
      /** Kinds of organisation whose land isn't rateable (schools, public health), besides the outside world's. */
      rates_exempt_kinds?: string[];
      median_house_price: number;
    };
    services: {
      waste_per_person_per_day_g: number;
      /** What the landfill charges the town for a tonne of waste. Left out where it charges nothing. */
      landfill_levy_per_tonne?: number;
      council_staff_per_1000: number;
      collect_seconds_per_10kg: number;
      asset_life_years: number;
      upkeep_hours_per_week_per_asset: number;
      complain_bps: number;
    };
    unions: { membership_bps: { [kind: string]: number }; dues_per_month: number; resignation_notice_days: number; claim_margin_bps: number; meeting_every_days?: number; teaching?: string };
    /** Social groups that meet (clubs, congregations): their kinds, how often and how long they meet, how many. */
    groups?: { kinds: { kind: string; name: string; every_days: number; lasts_minutes: number; teaching?: string; held_at_start_bps?: number }[]; per_kind_per_1000_people: number; taking_part_bps: number; leave_notice_days: number };
    /** Health (docs/design/world-expansion.md 4): the clinic's doctors, their care for conditions (as consultations), and who
     * seeks it; the conditions that keep someone off work. */
    health?: { doctors_per_1000: number; doctor_wage_per_pay_period: number; consult_minutes: number; seek_care_bps: number;
      treats: { kind: "illness" | "injury"; severity?: string; consults: number; days_kept_bps: number; fatal_kept_bps: number }[]; off_work_severities: string[] };
    /** Education (world-expansion 4): school ages, staffing, the school year, adults' attainment (as years of schooling), and
     * the return to a year of it. */
    education?: { school_ages: [number, number]; students_per_teacher: number; school_days_per_year: number; hours_per_day: number; teacher_wage_per_pay_period: number;
      attainment: { label: string; share_bps: number; years: number }[]; return_per_year_bps: number; max_years: number };
    /** The daily round (world-expansion 6.3): working and school hours, and what crossing a cell takes (seconds). */
    round?: { work_start_hour: number; work_end_hour: number; work_days: number; school_start_hour: number; school_end_hour: number; travel_seconds_per_cell: number; travel_by_cover: { [cover: string]: number };
      /** Roads (world-expansion 6.3): a road cell's travel time, how far from one a building may stand before the town builds
       * toward it, and what the town budgets for roads a year per resident (cents). */
      roads?: { seconds_per_cell: number; within_cells: number; budget_per_resident: number } };
    /** Home ownership (world-expansion 6.2): which houses their households own, with a mortgage or outright. */
    ownership?: { house_owner_bps: number; mortgage_bps_by_age: { from: number; bps: number }[]; mortgage_payment_per_month: number; mortgage_rate_bps: number; mortgage_years_left: [number, number];
      /** Buying and selling homes: a renting household's chance a month, the deposit and costs (of the price), the mortgage term; a seller's price cut when unsold. */
      market?: { buy_bps_per_month: number; deposit_bps: number; costs_bps: number; mortgage_months: number; relist_days: number; cut_bps: number; floor_bps: number } };
    /** Utilities (world-expansion 6.1): water drawn from the river and billed to owners; energy bought from the grid and
     * billed to households. */
    utilities?: {
      water: { litres_per_person_per_day: number; price_per_kl: number; service_per_quarter: number; river_inflow_kl_per_cell_per_day: number; river_decay_bps_per_day: number; river_flow_bps_per_day: number };
      energy: { kwh_per_household_per_day: number; price_per_kwh: number; supply_per_day: number; grid_price_per_kwh: number; grid_emissions_g_per_kwh: number };
    };
    /** Floods (world-expansion 7.3): the river's banks and spill, how deep before a building floods, wetland's soaking. */
    /** The climate (world-expansion 7.3), for weather drawn for a run: the river's inflow by calendar month (10,000 = the
     * year's usual), heavy rain (a month's chance, how many days, how much), drought (a year's chance, how many months,
     * how little), and heatwaves (a summer week's chance, how many days; heat on the land and, more, on built ground;
     * the yearly chance of illness each unit of heat adds). */
    climate?: { rain_by_month_bps: number[]; storm_bps_per_month: number; storm_days: [number, number]; storm_bps: number;
      drought_bps_per_year: number; drought_months: [number, number]; drought_bps: number;
      summer_months: number[]; heatwave_bps_per_week: number; heatwave_days: [number, number]; heat_units: number; built_heat_units: number; heat_illness_bps_per_unit: number;
      warning_lead_days: number };
    hazards?: { river_bank_kl: number; spill_bps_per_day: number; flood_above_kl: number; wetland_soak_kl_per_day: number };
    /** Crime and policing (world-expansion 7.2): how rarely people in need take from work, the police's establishment, and
     * how often an investigation finds who. */
    crime?: { take_bps_per_month_in_need: number; caught_bps_reckoned: number; take_quantity: number; detection_bps: number; investigation_hours: number; police_per_1000: number; officer_wage_per_pay_period: number };
    /** Justice (world-expansion 5): the tribunal's times, and how often people take a case to it. */
    justice?: { hearing_after_days: number; pay_within_days: number; challenge_bps: number; apply_bps: number; apply_after_days: number };
    /** Elections and the local paper (docs/design/world-expansion.md 3). */
    elections?: { term_years: number; method: "preferential" | "plurality";
      /** Whether the law here requires electors to vote (the town's election law says so, or that they may). */
      compulsory_voting: boolean; turnout_bps: number; stand_bps: number; news_readers_bps: number };
    /** Nature (docs/design/world-expansion.md 2): the landscape around the town, its covers, pollution, and species in
     * real units (per hectare, hectares), converted to cells by the generator with `cell_m`. */
    nature?: {
      cell_m: number;
      landscape: { margin_cells: number; block_cells: number; shares_bps: { [cover: string]: number }; woodland_patches: number };
      covers: { id: string; succeeds_to?: { cover: string; after_years: number } }[];
      default_cover: string;
      cleared_cover: string;
      river_cover: string;
      pollution: { decay_bps_per_day: number; diffusion_bps_per_day: number; flow_bps_per_day: number; per_factory_per_day: number; per_farmland_cell_per_day: number };
      species: { id: string; name: string; density_per_ha: { [cover: string]: number }; home_range_ha: number; growth_bps_per_year: number; mortality_bps_per_year: number; dispersal_bps_per_year: number; dispersal_m?: number;
        barriers?: string[]; min_viable: number; tolerance?: { [field: string]: { above: number; mortality_bps_per_day: number } }; detection_bps: number; conspicuous?: boolean; listed?: boolean }[];
      survey_hours_per_ha: number;
      survey_staff: number;
      spin_up_years?: number;
    };
  };
  /** A source for each value (a dotted path into `values`; a value is covered by its own path or a parent's). */
  sources: { [path: string]: string };
  /** What the world's outcomes should look like, with sources: measured against, never set (docs/calibration.md). */
  targets: { what: string; value: number; source: string }[];
}

export const PROFILE_DIR = join(import.meta.dir, "../profiles");

export function loadProfile(id: string): Profile {
  return JSON.parse(readFileSync(join(PROFILE_DIR, `${id}.json`), "utf8")) as Profile;
}
