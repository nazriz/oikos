// A profile: every place-specific figure a generator uses, with its source (docs/profiles.md). The generator's code is
// the same for every place; a world for another place and time is another profile.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HouseholdSpec } from "@terrarium/participants";

export interface Profile {
  id: string;
  place: string;
  as_of: string;
  about?: string;
  values: {
    currency: { code: string; minor_units: number };
    households: HouseholdSpec;
    fertility_per_10000: { from: number; rate: number }[];
    life: {
      qx_per_100000: { male: number[]; female: number[] };
      illness: unknown;
      injury: unknown;
      birth: { ages: [number, number]; gestation_days: number; female_bps: number };
      work_injury_bps: { factory: number; shop: number };
      /** Deaths care could prevent: the share of each age's deaths that's treatable, carried by an illness band. */
      treatable?: { share_bps_by_age: { from: number; bps: number }[]; band: string };
    };
    ordinary_hours_per_week: number;
    wages_per_fortnight: { shop: number; factory: number; construction: number };
    rents_per_month: {
      apartment_units: { bedrooms: number; count: number; rent: number }[];
      house_types: { id: string; bedrooms: number; share_bps: number; rent: number }[];
    };
    spending: { saving_bps: number; wealth_effect_bps_per_year: number; essentials_per_month: number };
    retirement_age: number;
    labour_force_participation_bps: number;
    tenancy: { rent_review_months: number; rent_increase_notice_days: number; after_fixed_term?: "periodic" };
    values: { [value: string]: { mean_bps: number; sd_bps: number } };
    industrial_action: { ballot_turnout_bps: number; ballot_pass_bps: number; notice_days: number; paid_during_action: boolean };
    world_price_process: { [kind: string]: { sd_bps: number; persistence_bps: number } };
    credit: {
      cash_rate_bps: number; funding_spread_bps: number; lending_rate_bps: { person: number; organisation: number }; serviceability_buffer_bps: number;
      max_repayment_share_bps: { person: number; organisation: number }; arrears_days: number; default_days: number; max_months: number;
    };
    retiree_savings: [number, number];
    support: { pension: { amount: number; every_days: number; from_age: number }; unemployment: { amount: number; every_days: number; from_age: number } };
    wealth_quintile_shares_bps: [number, number, number, number, number];
    outside_ownership_bps: { factory: number; shop: number; landlord: number };
    industry: { factory_labour_share_bps: number; factory_input_share_bps: number; retail_purchases_share_bps: number; retail_labour_share_bps: number };
    prices: { goods_world: number; goods_import_markup_bps: number; inputs_per_kg: number; materials_per_kg: number };
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
      landfill_levy_per_tonne: number;
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
    health?: { doctors_per_1000: number; doctor_wage_per_fortnight: number; consult_minutes: number; seek_care_bps: number;
      treats: { kind: "illness" | "injury"; severity?: string; consults: number; days_kept_bps: number; fatal_kept_bps: number }[]; off_work_severities: string[] };
    /** Education (world-expansion 4): school ages, staffing, the school year, adults' attainment (as years of schooling), and
     * the return to a year of it. */
    education?: { school_ages: [number, number]; students_per_teacher: number; school_days_per_year: number; hours_per_day: number; teacher_wage_per_fortnight: number;
      attainment: { label: string; share_bps: number; years: number }[]; return_per_year_bps: number; max_years: number };
    /** Home ownership (world-expansion 6.2): which houses their households own, with a mortgage or outright. */
    ownership?: { house_owner_bps: number; mortgage_bps_by_age: { from: number; bps: number }[]; mortgage_payment_per_month: number; mortgage_rate_bps: number; mortgage_years_left: [number, number] };
    /** Utilities (world-expansion 6.1): water drawn from the river and billed to owners; energy bought from the grid and
     * billed to households. */
    utilities?: {
      water: { litres_per_person_per_day: number; price_per_kl: number; service_per_quarter: number; river_inflow_kl_per_cell_per_day: number; river_decay_bps_per_day: number; river_flow_bps_per_day: number };
      energy: { kwh_per_household_per_day: number; price_per_kwh: number; supply_per_day: number; grid_price_per_kwh: number; grid_emissions_g_per_kwh: number };
    };
    /** Justice (world-expansion 5): the tribunal's times, and how often people take a case to it. */
    justice?: { hearing_after_days: number; pay_within_days: number; challenge_bps: number; apply_bps: number; apply_after_days: number };
    /** Elections and the local paper (docs/design/world-expansion.md 3). */
    elections?: { term_years: number; method: "preferential" | "plurality"; turnout_bps: number; stand_bps: number; news_readers_bps: number };
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
