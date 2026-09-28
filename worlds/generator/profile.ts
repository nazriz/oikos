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
    retiree_savings: [number, number];
    support: { pension: { amount: number; every_days: number; from_age: number }; unemployment: { amount: number; every_days: number; from_age: number } };
    wealth_quintile_shares_bps: [number, number, number, number, number];
    outside_ownership_bps: { factory: number; shop: number; landlord: number };
    industry: { factory_labour_share_bps: number; factory_input_share_bps: number; retail_purchases_share_bps: number; retail_labour_share_bps: number };
    prices: { goods_world: number; goods_import_markup_bps: number; inputs_per_kg: number; materials_per_kg: number };
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
