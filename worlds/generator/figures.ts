// What the generator's figures are made from (docs/design/foundations-2.md, law 11; step N2, counting only).
//
// Each row names where in a generated config a kind of number is (a dotted pattern over the config's paths: `*` one
// segment, `**` any number of them; array positions and ids are `*`) and what it rests on: a profile path (its note
// then gives the class), or a class and why. The first row that matches is used. Read by `orchestrator/src/figures.ts`
// to count what a world rests on; nothing in the generator or the world reads it, so it changes no town.
//
// A row is a statement about the generator, so it must be true of the code beside it: when the generator changes where
// a figure comes from, its row changes too. What no row covers is counted as unbased and listed in the report, and the
// list in `orchestrator/test/fixtures/figures-unbased.json` may only shrink.

export type BasisClass = "sourced" | "to_confirm" | "derived" | "fitted" | "placeholder" | "convention";

export interface Basis {
  /** The pattern over the config's paths. */
  at: string;
  /** The profile's dotted path the figure is made from (its note gives the class). */
  profile?: string;
  class?: BasisClass;
  why?: string;
  /** Only where this module runs (its parameters). */
  module?: string;
  /** Rows made together from one statement (a parameter wherever a module's parameters are): one of them must speak
   * for something. */
  family?: string;
}

const conv = (at: string, why: string): Basis => ({ at, class: "convention", why });
const derived = (at: string, why: string): Basis => ({ at, class: "derived", why });
const placeholder = (at: string, why: string): Basis => ({ at, class: "placeholder", why });
const prof = (at: string, profile: string): Basis => ({ at, profile });

/** Rows for one module's parameters (`participants.*.controller.params.<at>`), read only where that module runs. */
const of = (module: string, rows: Basis[]): Basis[] =>
  rows.flatMap((r) => ["participants.*.controller.params", "templates.*.controller.params", "positions.*.role_module.params"].map((at) => ({ ...r, module, family: `${module}: ${r.at}`, at: `${at}.${r.at}` })));

const CITIZEN = "citizen.default";

export const FIGURE_BASIS: Basis[] = [
  // The world's starting state: when, and who.
  conv("world.records.*.at", "the moment a record was made: the world's start"),
  derived("world.records.*.data.born_at", "drawn from the profile's age structure (households, life)"),
  derived("world.records.*.data.years_before", "a child's years at school, from their age and the profile's school ages"),
  derived("world.records.*.data.every", "an agreement's period: the profile's pay period or rent month"),
  derived("world.records.*.terms.termination.*.notice", "the law's notice, from the profile's tenancy and employment sections"),
  prof("world.populations.*.count", "nature"),
  // What a seat may see: the sizes of the areas and how often (the generator's design of knowing, docs/no-god-view.md).
  conv("participants.*.channels.**", "what a seat may see and how often: the platform's design of knowing (docs/no-god-view.md)"),
  conv("templates.*.channels.**", "what a seat may see and how often: the platform's design of knowing (docs/no-god-view.md)"),
  // The citizen (generate.ts, `citizenController`).
  ...of(CITIZEN, [
    derived("population", "the town's adult count, drawn from the profile's households"),
    prof("complain_bps", "services.complain_bps"),
    prof("job_move.**", "job_move"),
    prof("belief.fade_bps", "belief.living_fade_bps_per_month"),
    prof("frictions.bill_over_bps", "frictions.bill_over_bps"),
    prof("frictions.answer_days", "frictions.venues.answer_days"),
    prof("frictions.faulty_bps_per_year", "frictions.per_adult_bps_per_year"),
    prof("frictions.faulty_share_bps", "frictions.goods_faulty_share_bps"),
    prof("frictions.faulty_by_kind.**", "frictions.complaints_by_kind_bps"),
    prof("school.ages.*", "education.school_ages"),
    prof("care.seek_bps", "health.seek_care_bps"),
    placeholder("care.wait_days", "two days before care is sought again: the generator's"),
    prof("demand.kinds.**", "spending.demand.kinds"),
    prof("demand.frisch_bps", "spending.demand.frisch_bps"),
    derived("demand.reference_budget", "the town's own household budget at its start"),
    derived("demand.reference_prices.*", "the town's own opening prices"),
    prof("welfare.found_after.**", "life.found_alone_after"),
    prof("shop_search_bps", "spending.shop_search_bps_per_month"),
    prof("shops_known", "spending.shops_known"),
    prof("market.buy_bps", "ownership.market.buy_bps_per_month"),
    prof("market.deposit_bps", "ownership.market.deposit_bps"),
    prof("market.costs_bps", "ownership.market.costs_bps"),
    prof("market.mortgage_months", "ownership.market.mortgage_months"),
    prof("market.relist_days", "ownership.market.relist_days"),
    prof("market.cut_bps", "ownership.market.cut_bps"),
    prof("market.floor_bps", "ownership.market.floor_bps"),
    derived("market.bedrooms_by_type.*", "the house types' bedrooms, from the generator's house types"),
    prof("crime.take_bps", "crime.take_bps_per_month_in_need"),
    prof("crime.caught_bps", "crime.caught_bps_reckoned"),
    prof("crime.quantity", "crime.take_quantity"),
    prof("round.**", "round"),
    prof("tribunal.challenge_bps", "justice.challenge_bps"),
    prof("tribunal.apply_bps", "justice.apply_bps"),
    prof("tribunal.apply_after_days", "justice.apply_after_days"),
    prof("civic.turnout_bps", "elections.turnout_bps"),
    prof("civic.stand_bps", "elections.stand_bps"),
    prof("civic.reads_news_bps", "elections.news_readers_bps"),
    placeholder("civic.approval_memory_weeks", "half a year's memory of how an office has done: the generator's"),
    placeholder("civic.news_weight_bps", "the weight of the news in judging an office: the generator's"),
    placeholder("civic.platform_weight_bps", "the weight of a candidate's platform: the generator's"),
    prof("union_join_bps", "unions.membership_bps"),
    placeholder("public_memory.**", "what a person keeps of public goings-on: placeholders, not fitted (docs/behaviour/citizen.md)"),
    prof("participation_bps", "labour_force_participation_bps"),
    prof("values.**", "values"),
    prof("outlook.**", "outlook"),
    conv("year", "the year's length in seconds"),
    derived("gestation", "the life physics' gestation"),
    prof("fertility_per_10000", "fertility_per_10000"),
    placeholder("buffer_months", "the months of spending a household keeps by: the generator's (SAVINGS_KEPT_MONTHS)"),
    prof("saving_bps", "spending.saving_bps"),
    prof("wealth_effect_bps_per_year", "spending.wealth_effect_bps_per_year"),
    prof("essentials", "spending.essentials_per_month"),
    prof("retirement_age", "retirement_age"),
    prof("stop_work_curve.**", "labour_force_share_by_age"),
    derived("ventures.**", "a venture's settings: the town's own shops' (their wage the profile's, the rest the generator's)"),
    prof("founding.**", "founding"),
    derived("own_values", "a person's values, drawn from the profile's values"),
    prof("union_join_bps", "unions.membership_bps"),
    prof("possession", "tenancy.possession"),
    derived("stops_work_at", "an age to stop work, drawn from the profile's labour_force_share_by_age"),
    derived("beliefs", "a person's beliefs, drawn from the profile's belief section"),
    prof("fertility_per_10000", "fertility_per_10000"),
  ]),
  conv("dials", "a researcher's setting for the run (the spec's dials), not a figure of a place"),
  // Shop premises a landlord lets (docs/behaviour/leasing.md): the profile's commercial terms.
  ...of("firm.landlord", [
    prof("commercial.rent", "commercial.rent_per_month"),
    prof("commercial.deposit_months", "commercial.deposit_months"),
    prof("commercial.term_months", "commercial.term_months"),
    prof("commercial.notice_days", "commercial.notice_days"),
  ]),
  ...of(CITIZEN, [
    derived("attach_mean", "the town's mean attachment, from the profile's outlook.residence and outlook.job_tenure"),
    placeholder("frictions.*.at", "the level of a variable at which a home is counted as in fault: the generator's"),
  ]),
  // The rest of the starting state.
  derived("world.entities.*.born_at", "drawn from the profile's age structure"),
  derived("world.entities.*.variables.skill", "years of schooling, from the profile's education"),
  derived("world.records.*.data.members.*.born_at", "drawn from the profile's age structure"),
  placeholder("world.accounts.*.balance", "opening balances: the profile's wealth and savings by age where it has them, the generator's opening months elsewhere (ME-11)"),
  derived("world.records", "a record's terms: the profile's wages, rents, periods and laws, as the generator writes them"),
  derived("world.ground", "the ground's layout, drawn by the generator from the spec's grid"),
  derived("world.places", "the places on the ground, drawn by the generator from the spec's grid"),
  placeholder("world.holdings", "opening stocks: the generator's days of trade"),
  prof("life.illness", "life.illness"),
  prof("life.injury", "life.injury"),
  prof("life.birth", "life.birth"),
  derived("life.other_causes", "deaths by age from the profile's life table (life.qx_per_100000), less illness and injury"),
  // Parameters several modules take, from the same sections of the profile.
  ...[
    prof("households", "households"),
    prof("savings_by_age", "savings_by_age"),
    prof("automation", "automation"),
    prof("adjust", "employment.adjustment"),
    prof("wage", "wages_per_pay_period"),
    derived("working_day", "the working day, from the profile's ordinary hours a week"),
    derived("per_resident_per_year", "the profile's grants or charges per resident, by the town's count"),
  ].flatMap((r) => ["participants.*.controller.params", "templates.*.controller.params", "positions.*.role_module.params"].map((at) => ({ ...r, family: `any module: ${r.at}`, at: `${at}.${r.at}` }))),
  prof("catalogue.fields", "nature"),
  prof("catalogue.species", "nature"),
  prof("catalogue.land_covers", "nature"),
  placeholder("catalogue.structure_types", "buildings' sizes, rooms and build times: the generator's (docs/behaviour/generator.md)"),
  placeholder("catalogue.variables", "a building's variables and their rates: the generator's, or the profile's where it gives them (WM-11)"),
  conv("knowing.keepers.*.answers.*.most", "how many a keeper answers at once: one thing at a time, the platform's design of knowing"),
];
export { conv, derived, placeholder, prof };
