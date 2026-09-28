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
    tenancy: { rent_review_months: number; rent_increase_notice_days: number };
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
