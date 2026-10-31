// A profile: every place-specific figure a generator uses, with its source (docs/profiles.md). The generator's code is
// the same for every place; a world for another place and time is another profile.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Charge, Currency, HouseholdSpec, PaymentRule, ReturnRule } from "@oikos/participants";

/** Shares of people by years of residence, job tenure or membership: bands in basis points summing to 10000, each but the last under a number of years. */
export interface TenureBands { bands: { under_years?: number; bps: number }[]; placeholder?: boolean }

/** The problems with a set of bands (empty: well formed): sums to 10000, `under_years` strictly increasing and positive, the last band open. */
export function tenureBandProblems(b: TenureBands | undefined): string[] {
  if (!b || !Array.isArray(b.bands) || b.bands.length < 1) return ["no bands"];
  const out: string[] = [];
  let last = 0, sum = 0;
  b.bands.forEach((x, i) => {
    if (!Number.isInteger(x.bps) || x.bps < 0) out.push(`band ${i}: bps must be a non-negative integer`);
    sum += x.bps;
    const open = i === b.bands.length - 1;
    if (open && x.under_years !== undefined) out.push("the last band must be open (no under_years)");
    if (!open) { if (!(typeof x.under_years === "number" && x.under_years > last)) out.push(`band ${i}: under_years must be a number above ${last}`); else last = x.under_years; }
  });
  if (sum !== 10_000) out.push(`bands sum to ${sum}, not 10000`);
  return out;
}


/** A name and how common it is among those the list covers (relative: only ratios matter; whole numbers). */
export interface Weighted { name: string; weight: number }

/** What a profile states about names (docs/design/names-and-dates.md section 2). Frequencies only: nothing here is a
 * record of a person. Every list has its source in `sources["names.*"]`, or says PLACEHOLDER and what it stands on. */
export interface NamesSection {
  /** How a full name is made. */
  customs: {
    /** Where a child's family name comes from: "father" (one family name, the father's), "both" (two: the father's then
     * the mother's, as in Iberian-descended places), "father_given" (the father's given name stands as the second name:
     * a patronymic), or "own" (each adult draws a family name of their own). */
    family_name_from: "father" | "both" | "father_given" | "own";
    /** The order a name is written in. */
    order: "given_first" | "family_first";
    /** With `family_name_from: "both"`: whose family name is written first ("father_first", the default, or "mother_first"). */
    surname_order?: "father_first" | "mother_first";
    /** Of married couples, the share (basis points) in which the wife takes the husband's family name; the rest keep their own. */
    wife_takes_husband_bps: number;
    /** How a person is addressed on paper, by sex ("Mr", "Ms", "Sr.", "Sra."); left out: none. */
    titles?: { male?: string; female?: string };
  };
  /** Given names by sex and cohort of birth: each cohort lists names for those born from `born_from` (a year) until the next cohort's year. Ascending. */
  given: { male: { born_from: number; names: Weighted[] }[]; female: { born_from: number; names: Weighted[] }[] };
  /** Family names. `by_group` replaces `all` for people of a group the profile's `culture.origin` names, where the
   * group is a country of birth, a nationality or a language community; never for caste, race or colour. */
  family: { all: Weighted[]; by_group?: { [group_id: string]: Weighted[] } };
  /** Names of bodies, by pattern. A template's `{family}` is a family name drawn from the profile's list, `{town}` the
   * town's name, `{street}` a street name, and `{x}` for any other `x` an entry of `lists`. */
  organisations: {
    lists?: { [list: string]: string[] };
    landlord: { template: string; weight: number }[];
    shop: { template: string; weight: number }[];
    factory: { template: string; weight: number }[];
    /** Of the town's landlords, the share (basis points) that are a person (named as a person is) and not a company. */
    landlord_is_person_bps: number;
  };
  /** The town's name (a plausible one, not a real town's) and the names of the place's bodies, by the keys the generator uses
   * (`city`, `bank`, `builder`, `union`, `land_registry`, `tribunal`, `ombudsman`, `consumer_desk`, `electoral_commission`,
   * `paper`, `police`, `water`, `energy`, `clinic`, `school`, `retirement_fund`). `{town}` stands for the town's name. */
  town: string;
  institutions: { [key: string]: string };
  /** The references offices issue for what they file, by series (`lease`: a landlord's numbering of its tenancies; `case`: a
   * tribunal's): a pattern with `{y}` the year, `{n}` the office's own running number, `{n4}`/`{n6}` padded. Each has its
   * source in `sources["names.references"]`. Left out for a series: its records carry no reference. */
  references?: { [series: string]: string };
  /** Streets and addresses. `streets: []` where the place does not name streets; then `building` is the whole address. */
  places: {
    streets: string[];
    /** How a building's address is written: `{number}` (by position along the street), `{street}`. */
    building: string;
    /** How a home in a block of flats is written, `{unit}` the flat's number and `{building}` the building's address. */
    unit: string;
  };
}

/** A public holiday, by the rule that gives its date each year. */
export type HolidayRule = { name: string } & (
  | { fixed: { month: number; day: number } }
  | { nth_weekday: { month: number; weekday: number; n: number } }
  | { easter_offset: number }
  | { on: string[] }
) & {
  /** A holiday on a day of rest is kept on the next day that is not. */
  shift_if_rest?: boolean;
  /** Where the place keeps a holiday that falls on a Saturday or a Sunday: days to move it by (2: the Monday; -1: the Friday). Takes the place of `shift_if_rest`. */
  observed?: { saturday?: number; sunday?: number };
};

/** The place's calendar for civil life (docs/design/names-and-dates.md section 5). */
export interface CalendarSection {
  /** The first day of a run in this place (YYYY-MM-DD): the profile's reference date; a spec may override it. */
  start_date: string;
  /** How a date is written: tokens `{d}` (day), `{dd}` (two digits), `{month}` (the month's name), `{m}` (number), `{y}` (year). */
  format: string;
  /** The same with the weekday: `{weekday}` too. */
  long_format: string;
  /** Twelve month names, January first, as the place's papers print them, in the language seats read. */
  months: string[];
  /** Seven weekday names, Monday first. */
  weekdays: string[];
  /** The days of rest in a week (Monday 0 to Sunday 6). */
  weekend: number[];
  /** The weekday a week begins on (Monday 0 to Sunday 6). */
  week_starts: number;
  /** The month and day the fiscal year of public bodies begins. */
  fiscal_year_starts: { month: number; day: number };
  holidays: HolidayRule[];
}

export interface Profile {
  id: string;
  place: string;
  as_of: string;
  about?: string;
  values: {
    /** What people are called here (read only by a town whose spec turns `names` on). */
    names?: NamesSection;
    /** The place's calendar (read only by a town whose spec turns `calendar` on). */
    calendar?: CalendarSection;
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
    /** Who knows what (docs/behaviour/knowing.md): how long looking at one place gone to takes; what a search of the
     * land register costs (recorded; nobody is charged yet). */
    /** How long the place's work takes, in world seconds, by actor and by block or by block and what it makes
     * (`publish/<kind of record>`; docs/design/foundations.md law 2): rows laid over the generator's neutral placeholders,
     * each with its source in `sources` (keyed `person.<row>` or `system.<row>`). Left out: the placeholders stand. */
    work_time?: { person?: Record<string, number>; system?: Record<string, number>; sources?: Record<string, string> };
    knowing?: { visit_seconds: number; /** How long reading one meter takes someone who has gone to it. */ meter_read_seconds?: number; title_search_fee?: number; index_search_fee?: number };
    /** The working week a full-time wage is pay for, in hours: what people here work, not a legal ceiling above it. The
     * generator spreads it over the days of the week people work, and reckons an hour's pay from it. */
    ordinary_hours_per_week: number;
    /** How often wages are paid here, in days (14, 30...). */
    pay_period_days: number;
    /** A full-time wage by kind of work, gross, for one pay period. */
    wages_per_pay_period: { shop: number; factory: number; construction: number };
    /** Work as it is actually arranged here, where that is not a registered job on a standing wage (docs/behaviour/
     * firms.md, "Informal work"). Each part is left out where the place's survey gives no figure, and the town is
     * then as it was: every job registered, on a standing wage.
     * `registered_bps`: of the jobs at employers of a kind (the kinds wages are given for), the share the employer
     * registers: withholds from, and reports. Left out for a kind: all of them.
     * `casual_bps`: of the jobs at employers of a kind, the share that is work by the day: taken on and paid by the
     * day, for the days worked, with no notice and no standing wage; `day_wage`: a day's pay for it, by kind (needed
     * for each kind that has a share). */
    /** Businesses born in a year, as a share of the businesses there are (the place's business demography, with its
     * source): a target to compare a town's births with, never a setting (docs/behaviour/entry.md, "Entry by expected
     * profit"; risk ME-1). */
    business?: { entry_bps_per_year: number;
      /** What running a business of one costs a month beside its stock: registration, a licence and the like (cents, with
       * its source). A founder counts it, and the business pays it (docs/behaviour/entry.md, "What a business costs"). */
      home_fixed_per_month?: number;
      /** The days a supplier ordinarily gives a business to pay for goods it has delivered (docs/behaviour/trade.md, "Trade credit"): a
       * factory gives them to the shops that buy from it, and the outside world to the factories that buy inputs. Left out: cash with order. */
      trade_credit_days?: number };
    employment?: { registered_bps?: { shop?: number; factory?: number; construction?: number };
      /** The place's law on ending a job for redundancy (docs/behaviour/firms.md, "Adjusting labour"), published in
       * the town as a law its employers read: the least notice and the redundancy pay owed, each by length of
       * service, in days of pay, a week being seven (`from_years`: from that many years' service on); and the number of employees below
       * which an employer owes no redundancy pay, where the law has one. Left out: no such law in the town. */
      termination?: { notice: { from_years: number; days: number }[]; redundancy_pay: { from_years: number; days: number }[]; small_employer_under?: number };
      /** How employers here adjust their staff to their trade: the months a firm smooths its trade over, and what
       * taking someone on costs it, in weeks of their pay. Left out: the modules' own (placeholders). */
      adjustment?: { smooth_months?: number; hiring_cost_weeks?: number; hours_step_bps?: number };
      /** The place's law on an employer cutting hours in place of ending jobs (docs/behaviour/firms.md, "Hours before
       * heads"), published in the town as a law its employers and workers read. `may_cut`: "notice" (by notice),
       * "consent" (with the employee's agreement) or "no" (not at all: firms here do not do it); `ordinary_week_hours`;
       * `notice_days`; `floor_bps` (the least hours it may cut to, as a share of the ordinary); `max_days` (the longest spell; 0: none
       * stated); `pay_bps` (the share of pay owed for hours cut) from `pay_owed_from` employees; `consent_bps` (of workers asked, the
       * share who agree: a placeholder). Left out: no such law in the town, and its firms do not cut hours. */
      hours?: { may_cut: "notice" | "consent" | "no"; ordinary_week_hours: number; notice_days?: number; floor_bps?: number; max_days?: number; pay_bps?: number; pay_owed_from?: number; consent_bps?: number };
      casual_bps?: { shop?: number; factory?: number; construction?: number }; day_wage?: { shop?: number; factory?: number; construction?: number };
      /** People who work for themselves, alone (docs/behaviour/entry.md, "A person working for themself"): of people
       * in work, the share who do (`share_bps`), and what they do, as the place's survey divides them (`kinds`, their
       * shares of own-account workers adding to 10,000). A kind says what it `does`: "trade" (buys goods and sells them
       * to households: the town can hold it), "make" (makes what it sells) or "service" (sells its work: a ride, a
       * repair); the last two the town cannot hold yet, and people of those kinds are drawn as they always were, in
       * jobs. And where it is worked `from`: "home" (the person's own dwelling) or "pitch" (a pitch in a market the
       * town keeps); and how many days of sales it keeps in stock (`stock_days`; left out: seven). */
      own_account?: { share_bps: number; kinds: { id: string; name: string; does: "trade" | "make" | "service"; share_bps: number; from?: "home" | "pitch"; stock_days?: number }[] } };
    rents_per_month: {
      apartment_units: { bedrooms: number; count: number; rent: number }[];
      house_types: { id: string; bedrooms: number; share_bps: number; rent: number }[];
    };
    /** A home's physical room: how many bodies it could hold for each bedroom, and how many besides. It stands for floor
     * area, which differs by place. Left out: the generator's own (generous) figures. What is suitable is not this but
     * the occupancy standard (`households.occupancy`). */
    homes?: { bodies_per_bedroom: number; bodies_besides: number };
    spending: { saving_bps: number; wealth_effect_bps_per_year: number; essentials_per_month: number; shops_known: number; shop_search_bps_per_month: number;
      /** The household demand system (docs/behaviour/demand.md): each kind's average share of spending and its income elasticity from the place's household expenditure survey, and Frisch's money flexibility. */
      demand?: { frisch_bps: number; kinds: { kind: string; share_bps: number; income_elasticity_bps: number;
        /** What a unit of it is, physically (law 8, docs/nothing-from-nothing.md): `stock` (a thing, which becomes waste when
         * used; the default), `dissipates` (fuel: its energy leaves the world as heat) or `service` (a unit of a service sold
         * over a counter, a haircut or a visit to a venue: no physical quantity, used as it is bought). */
        class?: "stock" | "dissipates" | "service";
        /** What a shop that sells this kind is like (docs/behaviour/demand.md, "A town's mix of shops"): a kind with no `seller` is not sold by shops (energy is billed by the utilities). `wholesale_bps`: what the shop pays for a unit as a share of its retail price (left out for `goods`: the profile's `industry.retail_purchases_share_bps`); `labour_bps`: the staff's pay for serving a unit as a share of its price, which fixes the size of the unit (left out for `goods`: `industry.retail_labour_share_bps`); `business_share_bps`: the kind's share of the place's retail and service businesses, where counts by industry are sourced (left out: the shops are divided by spending); `occupation`: what the shop's staff are, in the place's terms (the job a shop of this kind advertises); `wage_vs_shop_bps`: their pay as a share of `wages_per_pay_period.shop` (from the place's earnings survey by occupation; left out: the shop wage, 10,000). */
        seller?: { wholesale_bps?: number; labour_bps?: number; business_share_bps?: number; occupation?: string; wage_vs_shop_bps?: number } }[] } };
    /** An adult's savings (cash and deposits), by age: percentiles 10, 25, 50, 75, 90 (cents). */
    savings_by_age?: { from: number; pct: [number, number, number, number, number] }[];
    /** Shop premises to let (docs/behaviour/leasing.md; risk ME-1): `vacant_bps`, the share of a place's shop units that
     * stand empty (the town opens with that share of empty units beside its shops, let by its landlords); a lease's
     * `rent_per_month` for a small unit, its `deposit_months` (a security deposit, held and given back at the end),
     * `term_months`, and what a landlord asks to accept a tenant's surrender (`surrender_months` of rent, its practice).
     * `law`, the place's law on leases of shop premises (published as `law-premises-leases`; docs/behaviour/leasing.md,
     * "Remedies"): rent owed `arrears_days` before a landlord may end a lease for it, after `forfeiture_notice_days` of
     * notice (0: re-entry the next day); a tenant's own notice to end it early (`tenant_notice_days`; 0: none, only a
     * surrender agreed); a rent review at most every `review_months`, on `review_notice_days` of notice, `upward_only` or
     * not; and who hears a claim for rent owed (`disputes`: the town's tribunal). Each with its source; left out, no
     * premises to let. */
    commercial?: {
      vacant_bps: number; rent_per_month: number; deposit_months: number; term_months: number; surrender_months: number;
      law?: { arrears_days: number; forfeiture_notice_days: number; tenant_notice_days: number; review_months: number; review_notice_days: number; upward_only?: boolean; disputes?: "tribunal" };
    };
    /** How savings lean on pay (risk ME-17; docs/design/market-realism.md): the rank correlation of income and wealth
     * once age is accounted for (basis points), from a wealth survey. A person's savings are drawn from their age's
     * distribution at a rank that leans on their pay's rank by it. Left out: drawn on their own, as before. */
    income_wealth_rank_bps?: number;
    /** How work is shared within households (risk ME-17): the labour force survey's share of households in which nobody
     * is in work (`workless_bps`), of the households it counts (`of`: "working_age", households with a member of working
     * age; "families", households of two or more people, of any age, as some surveys count). The town's
     * households share a common factor in who works, fitted to it; each person's own chances stay the profile's. Left
     * out: each person drawn on their own, as before. */
    household_work?: { workless_bps: number; of: "working_age" | "families" };
    /** The age people here stop work, where the profile gives one age for everyone; with `labour_force_share_by_age`,
     * the age the profile's other figures by age turn on (the retired's savings, the end of the payments for those out
     * of work, a retirement fund's access) and the top of the working ages the measures use. */
    retirement_age: number;
    labour_force_participation_bps: number;
    /** The share of people in the labour force by age band, from the place's labour force survey (bands in order of
     * age; the first is the reference, the ages before leaving begins): each person in the labour force stops work at
     * an age drawn so that the shares by age come out as these do (docs/behaviour/citizen.md, "Stopping work"). Left
     * out: everyone stops at `retirement_age`. */
    labour_force_share_by_age?: { from: number; bps: number }[];
    /** Tenancy law. A place with no rule on how often a rent may rise or on what notice leaves both figures out (no
     * such law is written); landlords then review rents as often as `rent_review_practice_months` says, if it's given. */
    tenancy: {
      /** The place's law on possession of a let home for arrears (docs/behaviour/justice.md, "Possession"), published
       * in the town as a law: the days rent must be owed before a notice to vacate, the notice's days, the days from
       * the tribunal's order to its date for possession, the longest plan to pay it sets, in months, and the days
       * the police have to carry out a warrant. And two figures of how tenants answer: of those given a notice to
       * vacate they cannot pay off, the share who stay past its date; of those ordered out, the share gone by the
       * tribunal's date. Left out: a notice for arrears ends the lease and the tenant leaves, as before. */
      possession?: { arrears_days: number; notice_days: number; possession_days: number; plan_months: number; warrant_days: number; /** The notice of the day the enforcer must give the tenant before carrying a warrant out. */ eviction_notice_days: number; stay_past_notice_bps: number; leave_on_order_bps: number;
        /** Of tenants served with an application for possession, the share who answer it in writing or attend (the
         * citizen's rate, read against who each is). None: every tenant with something to offer answers, as before. */
        answer_bps?: number;
        /** What the law says of a plan to pay in place of possession: the tribunal `may` set one, `must` consider one
         * before it orders possession, or has `none` to set. None stated: `may` where `plan_months` is above nought. */
        plan_consider?: "may" | "must" | "none";
        /** Where the law takes the plan away once so many months' rent are owed on the day the tribunal decides. */
        plan_barred_rent_months?: number;
        /** Where the law ends the claim if everything owed is paid within so many days of the application. */
        cure_days?: number };
      end_notice_days?: number; tenant_notice_days?: number; rent_review_months?: number; rent_increase_notice_days?: number; rent_review_practice_months?: number; after_fixed_term?: "periodic";
      /** Rent as a share of household income among the place's renting households (docs/behaviour/generator.md, "Homes
       * by income"): the share of them in each band, lowest first, `under_bps` rising and the last band open; `of` says
       * what the source divides the rent by ("gross" or "net" income; "expenditure" where no income is surveyed, which the
       * generator reads as income before tax). A town's first tenancies are dealt by it. Left out: homes are dealt by
       * size alone, as before. */
      rent_share_of_income?: { of: "gross" | "net" | "expenditure"; bands: { under_bps?: number; bps: number }[]; placeholder?: boolean } };
    values: { [value: string]: { mean_bps: number; sd_bps: number } };
    /** What holds someone in a job they have (docs/behaviour/citizen.md, "Moving to another job"), read only for a living town: how much more another job must pay, and how much more again for each year they have been where they are. */
    job_move?: { premium_bps: number; per_year_bps: number; cap_years: number; other_trade_bps?: number };
    /** How fast a belief not kept up fades, a month, in a living town: fitted to the place's trend in stated affiliation (docs/behaviour/citizen.md, "Belief"). */
    belief?: { living_fade_bps_per_month?: number };
    /** What a town holds in common (docs/behaviour/culture.md), read only for a living town that turns the culture dial on:
     * for the conducts the build lists (participants/src/shared/culture.ts), the share who do each (`does_bps`) and the
     * share who approve of it (`approves_bps`), each figure with its source in `sources["culture.conducts"]` or marked a
     * placeholder; a conduct with no figure runs on the world's own rate and a marked placeholder. `origin`: where people
     * come from, as groups the place's own statistics name: `groups` (an id, a name, a share of the people, in basis
     * points summing to 10000), `same_household_bps` (of two adults living together, how often both are of one group),
     * `homophily_bps` (how much closer a tie forms between two of one group, as an added affinity), and `by_group` (any
     * conduct's figures for those of a group, replacing the place's). A profile with no `origin` has no such groups. */
    culture?: { conducts?: { [conduct: string]: { does_bps?: number; approves_bps?: number } };
      origin?: { groups: { id: string; name: string; share_bps: number }[]; same_household_bps: number; homophily_bps: number; by_group?: { [group: string]: { [conduct: string]: { does_bps?: number; approves_bps?: number } } } } };
    /** Everyday frictions (docs/behaviour/frictions.md), read only for a living town: of adults, the share who have
     * each kind of problem in a year; how often the other side puts a thing right when asked, by matter; the sizes
     * of a short pay, a wrong bill and a faulty lot of goods; a repair's hours; the support office's processing time
     * and its share of wrong refusals; and how the bodies that hear grievances work. Each with its source or marked
     * a placeholder. */
    frictions?: { per_adult_bps_per_year: { landlord: number; wages: number; bill: number; benefits: number; goods: number }; put_right_on_asking_bps: { [matter: string]: number };
      pay_short_by_bps: number; bill_over_bps: number; goods_faulty_share_bps: number; complaints_by_kind_bps?: { [kind: string]: number }; repair_hours: number; support: { wrong_refusal_bps: number };
      venues: { answer_days: number; tribunal_days: number; tribunal_fee_hours_of_pay: number; uphold_without_proof_bps: number } };
    /** The auditor (docs/behaviour/auditor.md; foundations B9): an office that examines other bodies' accounts and decisions as the place's law says, on a sample, and
     * publishes a report. `office`: what it is called here (a neutral name). `answer_within_days`: how long a body has to answer a request for one named item (the
     * law's power to ask). `report_within_days`: how soon after a period ends the law says the report is due (the office's work decides when it is). `bodies`: whom it
     * audits, each a role the generator knows: "support" (the office that decides claims for support and pays them) and "town_finance" (the town's finance office).
     * For each: `checks` ("decisions": a sample of the period's decisions re-decided from the file under the law and the procedure published for the kind; "accounts":
     * the period's payments in the body's books against the bank's record of them), `every_days` (the period; period n is days (n-1)*every to n*every of the run) and,
     * for decisions, `sample`: `share_bps` of the period's decisions of the kind, no fewer than `least`, no more than `most`. Each with its source in
     * `sources["audit.*"]`, or marked "PLACEHOLDER" or "(to confirm)". A place whose law has no such audit leaves `audit` out, and has no auditor. */
    audit?: { office: string; answer_within_days: number; report_within_days: number;
      bodies: { body: "support" | "town_finance"; every_days: number; checks: ("decisions" | "accounts")[]; sample?: { share_bps: number; least: number; most: number } }[] };
    /** What a decision waits for, and how it is reviewed and appealed (docs/behaviour/decisions.md; foundations F8): a list of rules, each for a kind of
     * decision (the kind of statement the office makes: `benefit_decision`) and, where the place's law differs by payment, for named payments only.
     * `needs`: what the decision waits for before it is made (papers from the claimant, a confirmation from their last employer), within so many days,
     * and `else` what comes of it when they do not come (`refuse`, or `decide` on what is on hand). `review`: the office looks at its own decision again
     * if asked within so many days, on what grounds, whether an appeal lies only after it (`required`), and, where the law takes silence as a
     * refusal, after how many days of asking an unanswered review counts as refused (`deemed_refused_days`; the appeal's days run from then), or, where it has none, after how many days a body that only recommends takes up the delay (`complaint_after_days`: an ombudsman's or a complaints examiner's; no appeal follows). `appeal`: the matter a venue that can set the
     * decision aside hears (`claim_refused`), within so many days, on what grounds, and its fee in hours of ordinary pay (0: none). `refused_by`: where the
     * office is a head and staff, whether the head alone may refuse. Each with its source (`sources["decisions.<kind>.<payment or all>"]`), or marked
     * "PLACEHOLDER" or "(to confirm)". A route a place's law lacks is left out (no `review`: no internal reconsideration). */
    decisions?: { kind: string; name: string; payments?: string[]; refused_by?: "office-holder" | "staff";
      needs?: { id: string; from: "claimant" | "employer"; what: string; within_days: number; else: "refuse" | "decide" }[];
      review?: { within_days: number; grounds: string; required?: boolean; deemed_refused_days?: number; complaint_after_days?: number };
      appeal?: { matter: string; within_days: number; grounds: string; fee_hours_of_pay: number } }[];
    /** Founding (docs/behaviour/founding.md), read only for a living town that turns it on: how often new associations
     * are registered here (`registered_per_100000_per_year`, with its source; code never reads it) and how many more
     * are never registered (`informal_multiple`, a placeholder), which together are what `chance_bps` (the chance at
     * an occasion, for a person of the town's mean temperament and standing) is FITTED to; and the sizes: how many
     * others must share the want; what a founder may ask in dues (minutes of ordinary pay a month, the first the
     * plain default); how often, how soon and how long a group gathers; when a thing nobody joins lapses; when a
     * member who no longer comes leaves; the hall's hire (hours of ordinary pay a gathering); a fund's and a
     * grievance body's rules. Each with its source or marked a placeholder. */
    founding?: { registered_per_100000_per_year: number; informal_multiple: number; chance_bps: number; shared_min: number; rest_days: number;
      dues_minutes_of_pay: number[]; every_days: number[]; starts_in_days: number[]; lasts_minutes: number[]; lapse_days: number; min_members: number; leave_after_days: number;
      hall_hire_hours_of_pay: number; fund: { qualify_days: number; draw_months: number; every_days: number }; cause: { case_hours: number; hours_per_member_month: number };
      shape_odds?: { [about: string]: { [shape: string]: number } }; sway?: { [what: string]: number } };
    /** How people here start out in what they trust and how much control they feel (docs/behaviour/citizen.md, "The
     * record"): the share with confidence in each kind of institution (government, policing, courts, civil_service,
     * banks, press, unions, religious, companies: whichever the place's survey gives), the share who say most people
     * can be trusted, and the mean and spread of how much control over their lives people feel. Whatever is left out
     * starts from the citizen's own placeholder. */
    outlook?: { trust?: { [kind: string]: number }; people_bps?: number; agency?: { mean_bps: number; sd_bps: number };
      /** Of those who asked for something, the share who got it: a pay rise from an employer (docs/behaviour/firm-wants.md). */
      asked?: { rise_granted_bps?: number };
      /** How long adults have lived at their address, how long the employed have been in their job, and (if a source exists) how long
       * people have belonged to a group they take part in: bands of shares of adults, in basis points summing to 10000, each with
       * `under_years` (strictly increasing), the last open (no `under_years`). `placeholder: true` marks a borrowed figure
       * (its source text begins "PLACEHOLDER:"). They set what attachment people start with (docs/profiles.md). */
      residence?: TenureBands; job_tenure?: TenureBands; group_years?: TenureBands };
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
    town_finance: { parks_per_year: number; payment_approval_over: number; unpermitted_building_fine: number };
    retiree_savings: [number, number];
    /** Support paid from outside the town, as its law's list of payments (docs/behaviour/boundary.md): each says who
     * qualifies, how much and for how long, and where it is paid from (`paid_from`: one of `public_finance.funds`; left
     * out: the general government). A place that has no such payment leaves it out of the list. */
    /** `take_up_bps`, by payment: of those the payment's rule already entitles as the year begins, the share who have
     * it in payment on the first day (docs/behaviour/generator.md, "Payments in force"). A payment not listed opens
     * with nobody drawing it, as before: its people claim in the year. */
    support: { payments: (Omit<PaymentRule, "payer" | "account"> & { paid_from?: string })[]; take_up_bps?: { [payment: string]: number } };
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
    industry: { factory_labour_share_bps: number; factory_input_share_bps: number; retail_purchases_share_bps: number; retail_labour_share_bps: number;
      /** The main manufacturing industries other than the general one above (which makes `goods`): the kind of thing households buy that each supplies, its share of the town's factories, its labour and input shares of its output and the input it uses. */
      manufacturing?: { product: string; share_bps: number; labour_share_bps: number; input_share_bps: number; input: string }[] };
    /** Prices at the world market. `goods_world` is the price of an item of goods, the town's own unit and no real
     * thing's price: left out, the generator derives it (an item is a fixed amount of factory work); stated, it fixes
     * the unit, and the generator checks it's a size the world's whole numbers can carry (docs/profiles.md). */
    prices: { goods_world?: number; goods_import_markup_bps: number; inputs_per_kg: number; materials_per_kg: number };
    public_finance: {
      /** Named funds and bodies of the higher government that charges on pay are paid to (and support may be paid
       * from), each an account of its own; what names none is the general government's. */
      funds?: { id: string; name: string }[];
      /** The tax on pay, as its law's list of charges (docs/behaviour/public-finance.md): each with what it is charged on,
       * its schedule, its reliefs, and whom it is paid to (`paid_to`: one of `funds`, or "town" for a local tax paid to
       * the town; left out: the general government). Yearly sums. */
      income_tax: { charges: (Omit<Charge, "collector" | "account"> & { paid_to?: string })[] };
      /** When employers report what they withheld and pay it over (docs/behaviour/firms.md, "Returns on the law's days"):
       * each return names the charges it reports (left out: those no other return reports), how many months a period is
       * (`every_months`, default 1), and the day it falls due by: `day`, counted from the first day of the month after
       * the period (`in: "following"`, the default) or of the period's last month (`"same"`). The world's months are
       * 30 days from the year's first day (the twelfth takes the last five). Left out: every charge monthly, on the first
       * day of the month after (a neutral stand-in). */
      returns?: ReturnRule[];
      /** The law on tax paid and not owed (docs/behaviour/public-finance.md, "The taxpayer's account"; risk PB-23): the collector keeps
       * each taxpayer's account and repays a credit claimed back within `pay_within_days` of the claim (said in the law; the time it
       * takes is its officers'); `set_off`: whether a taxpayer may instead set the credit against its next return; `wrong_refusal_bps`:
       * of the claims that are due, the share the collector refuses (a row of the table of slips, in a town with frictions). Its source
       * in `sources["public_finance.refunds"]`, or marked a placeholder. Left out: no collector keeps accounts, and nothing paid twice
       * can be claimed back. The review of a decision on a claim is the place's `decisions` rule for `tax_credit_decision`. */
      refunds?: { pay_within_days: number; set_off: boolean; wrong_refusal_bps: number };
      grants_per_resident_per_year: number;
      rates_per_resident_per_year: number;
      rates_instalments: number;
      rates_due_days: number;
      rates_penalty_interest_bps?: number;
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
    /** Who staffs the town's own offices and what they are paid (foundations F5; docs/behaviour/staffing.md): each post is held by a
     * resident hired from the town, at these rates per 1,000 residents (full-time equivalents; a body keeps at least one person),
     * paid `wage_per_pay_period`; and the systems an office runs are delivered under a licence at these prices. Each figure has its
     * source in `sources["public_service.*"]`, or is marked a placeholder. */
    public_service: {
      wage_per_pay_period: number;
      staff_per_1000: { administration: number; courts: number; oversight: number; elections: number; land_registry: number; press: number; banking: number; utilities: number; union: number; property_management: number;
        /** The auditor's staff (docs/behaviour/auditor.md): full-time equivalents per 1,000 residents, as any body's (a body keeps at least one). */
        audit?: number };
      licences: { payment_system: { per_resident_per_year: number; term_days: number } };
      /** The support agency's officers (full-time equivalents who handle claims) per 1,000 claims in payment, nationally: the town's
       * share of them is its casework desk (law 10; docs/behaviour/boundary.md, "Who decides a claim"). Sourced in
       * `sources["public_service.support_officers_per_1000_claims"]`, or marked a placeholder. */
      support_officers_per_1000_claims: number;
      /** Who fills a post of a body when none of its own staff is left (its constitution): "council" (the town's council, which seconds
       * one of its own staff to it). A body not named has none, and a post of it whose staff have all died stays empty. */
      appointed_by?: { [kind in "administration" | "audit" | "courts" | "oversight" | "elections" | "land_registry" | "press" | "banking" | "utilities" | "union" | "property_management" | "police"]?: "council" };
    };
    /** Automation (docs/behaviour/automation.md): the systems the outside world sells to businesses and offices, and how a business weighs them.
     * The prices are the outside world's, like world prices: held at today's level (`price_fall_bps_per_year` 0) unless a scenario gives a
     * yearly change. No figure here sets how many adopt or when. */
    automation?: {
      price_fall_bps_per_year: number;
      offers: { id: string; title: string; for: "firms" | "offices"; task?: string; kinds?: string[]; speed_bps: number; scope_bps: number; setup: number; fee_per_year: number; exit: number; term_days: number; notice_days: number; oversight_hours_per_month: number; error_bps: number }[];
      firms: { payback_months: { small: number; large: number }; large_from: number; hurdle_bps: number; reference_bps: number; on_cost_bps: number; most?: number };
      /** The law on public buying: a contract worth more than the threshold (in the world\'s smallest unit) is put out to tender, and bids are open this long. */
      procurement?: { threshold: number; bid_days: number };
    };
    /** Assistants on offer (docs/behaviour/assistants.md; docs/design/delegation.md): the outside world's providers of services
     * and what each sells, at today's prices; read only where a town asks for them (`assistants: true`). `claim_slip_bps` is
     * what a provider says; `slip_bps` is how often its systems really slip (the world's table of slips), which need not agree.
     * `principals`: what a principal weighs that no market gives (what an error costs it, the share of slips it finds in a draft
     * it reads, how much a claim counts against what it has seen, its hurdle); `review_misses_bps` how often a reading misses a
     * slip (a person's row in the table of slips). No figure here sets how much anyone delegates. */
    assistants?: {
      providers: { id: string; name: string; offers: { id: string; title: string; for: "organisations" | "persons"; template: string; kinds: string[]; levels: ("advice" | "draft" | "approve" | "alone")[];
        speed_bps: number; claim_slip_bps: number; slip_bps: number; fee_month: number; setup: number; exit: number; notice_days: number; term_days: number; records: "principal" | "provider" | "on_request" }[] }[];
      principals: { error_cost: number; finds_bps: number; prior_matters: number; hurdle_bps: number; review_days: number; horizon_months: number; review_misses_bps: number; complaints: string[] };
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
      roads?: { speed_kmh: number; capacity_per_hour: number; within_cells: number; budget_per_resident: number };
      /** Law 9 (foundations-2 S2): the kinds of vehicle (seats, top speed) and, of housed households, the share whose vehicle is
       * of each kind (at most one a household). */
      vehicles?: { types: { id: string; seats: number; speed_kmh: number }[]; households: { type: string; bps: number }[] } };
    /** Home ownership (world-expansion 6.2): which houses their households own, with a mortgage or outright. */
    /** `owner_bps_by_age`: of households, the share who own their home, by the age of the household's head; read as
     * how much likelier one household is than another to be among the town's owners (their number is the houses'). */
    ownership?: { house_owner_bps: number; owner_bps_by_age?: { from: number; bps: number }[]; mortgage_bps_by_age: { from: number; bps: number }[]; mortgage_payment_per_month: number; mortgage_rate_bps: number; mortgage_years_left: [number, number];
      /** Buying and selling homes: a renting household's chance a month, the deposit and costs (of the price), the mortgage term; a seller's price cut when unsold. */
      market?: { buy_bps_per_month: number; deposit_bps: number; costs_bps: number; mortgage_months: number; relist_days: number; cut_bps: number; floor_bps: number } };
    /** Utilities (world-expansion 6.1): water drawn from the river and billed to owners; energy bought from the grid and
     * billed to households. */
    utilities?: {
      /** The town's network for what flows (foundations-2 C4; worlds/generator/network.ts): its engineering figures, each a stand-in until sourced. */
      network?: import("./network").NetworkFigures;
      /** `bill_to`: whom the water bill goes to, the property's owner or its occupant, as the place's law has it (WM-12). */
      water: { litres_per_person_per_day: number; bill_to?: "owner" | "occupant"; price_per_kl: number; service_per_quarter: number; river_inflow_kl_per_cell_per_day: number; river_decay_bps_per_day: number; river_flow_bps_per_day: number };
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
