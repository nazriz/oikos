// What the generator's figures are made from (docs/design/foundations-2.md, law 11; step N2, counting only).
//
// Each row names where in a generated config a kind of number is (a dotted pattern over the config's paths: `*` one
// segment, `**` any number of them; array positions and ids are `*`) and what it rests on: a profile path (its note
// then gives the class: the note of the same part below it where the profile has one, `households.lone_bps` under
// `households`, else the path's own or the nearest above), or a class and why. A row may hold only for one id (`id`:
// which task, field or kind, where `*` covers several made from different figures) or only where the config has a
// path (`given`). The first row that matches is used. Read by `orchestrator/src/figures.ts`
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
  /** Only for a number under this id (a key of the name, or an element with this `id`): which task, field or kind,
   * where the pattern's `*` covers several made from different figures. */
  id?: string;
  /** Only where the config has this dotted path (a town with frictions has `dials.friction_bps`). */
  given?: string;
}

const conv = (at: string, why: string): Basis => ({ at, class: "convention", why });
const derived = (at: string, why: string): Basis => ({ at, class: "derived", why });
const placeholder = (at: string, why: string): Basis => ({ at, class: "placeholder", why });
const prof = (at: string, profile: string): Basis => ({ at, profile });

/** Rows for one module's parameters (`participants.*.controller.params.<at>`), read only where that module runs. */
const of = (module: string, rows: Basis[]): Basis[] =>
  rows.flatMap((r) => ["participants.*.controller.params", "templates.*.controller.params", "positions.*.role_module.params"].map((at) => ({ ...r, module, family: `${module}: ${r.at}`, at: `${at}.${r.at}` })));

/** Rows for one task of the catalogue's (`catalogue.tasks.*.<at>`, the task with this id). */
const task = (id: string, rows: Basis[]): Basis[] => rows.map((r) => ({ ...r, id, family: `task ${id}: ${r.at}`, at: `catalogue.tasks.*.${r.at}` }));

const CITIZEN = "citizen.default";

export const FIGURE_BASIS: Basis[] = [
  // The world's starting state: when, and who.
  conv("world.records.*.at", "the moment a record was made: the world's start"),
  derived("world.records.*.data.born_at", "drawn from the profile's age structure (households, life)"),
  derived("world.records.*.data.years_before", "a child's years at school, from their age and the profile's school ages"),
  derived("world.records.*.data.every", "an agreement's period: the profile's pay period or rent month"),
  derived("world.records.*.terms.termination.*.notice", "the law's notice, from the profile's tenancy and employment sections"),
  prof("world.populations.*.count", "nature.species"),
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
    prof("commercial.surrender_months", "commercial.surrender_months"),
  ]),
  ...of(CITIZEN, [
    derived("attach_mean", "the town's mean attachment, from the profile's outlook.residence and outlook.job_tenure"),
    placeholder("frictions.*.at", "the level of a variable at which a home is counted as in fault: the generator's"),
  ]),
  // Who comes for the job (world.migration): of working age, from adulthood to the profile's retirement age.
  ...of("world.migration", [derived("seeker_ages", "from adulthood (18) to the profile's retirement_age")]),
  // The rest of the starting state.
  derived("world.entities.*.born_at", "drawn from the profile's age structure"),
  derived("world.entities.*.variables.skill", "years of schooling, from the profile's education"),
  derived("world.records.*.data.members.*.born_at", "drawn from the profile's age structure"),
  placeholder("world.accounts.*.balance", "opening balances: the profile's wealth and savings by age where it has them, the generator's opening months elsewhere (ME-11)"),
  derived("world.records", "a record's terms: the profile's wages, rents, periods and laws, as the generator writes them"),
  prof("world.ground.cell", "nature.cell_m"),
  derived("world.ground", "the ground's layout, drawn by the generator from the spec's grid"),
  derived("world.places", "the places on the ground, drawn by the generator from the spec's grid"),
  placeholder("world.holdings", "opening stocks: the generator's days of trade"),
  prof("life.illness", "life.illness"),
  prof("life.injury", "life.injury"),
  prof("life.birth.gestation", "life.birth.gestation_days"),
  placeholder("life.birth.reach", "a child's other parent must be in the same cell (0 cells away): the generator's"),
  prof("life.birth", "life.birth"),
  derived("life.other_causes", "deaths by age from the profile's life table (life.qx_per_100000), less illness and injury"),
  conv("life.year", "a year of 365 days, in seconds"),
  prof("life.majority", "households.adult_ages"),
  // The run's own settings (the spec's and the platform's), not figures of a place.
  conv("seed", "the run's seed: a researcher's setting (the spec's)"),
  conv("clock.tick_seconds", "an hour: the kernel's tick, the platform's"),
  conv("clock.run_seconds", "the spec's years, of 365 days: the run's length, a researcher's setting"),
  conv("log", "how often the log keeps a checkpoint and an anchor: the log's bookkeeping, not a figure of the world"),
  placeholder("caps.max_created_entities", "the most entities a run's participants may create: a safety limit, the generator's, not a figure of any place"),
  // What a person knows by going to look (docs/no-god-view.md): the profile's minutes.
  prof("knowing.visit_seconds", "knowing.visit_seconds"),
  prof("positions.*.channels.*.look_seconds", "knowing.meter_read_seconds"),
  prof("world.currencies", "currency"),
  prof("world.nature_spin_up_days", "nature.spin_up_years"),
  placeholder("world.structures.*.variables", "a let home's disrepair at the start, drawn evenly below the level at which it is in fault: the generator's (frictions)"),
  derived("templates.*.does.*.seconds", "a system's seconds for its task: a person's (the town's make and serve times, or the table of work's row for the paper) at the offer's speed (automation.offers)"),
  // The catalogue: what the town's work takes, makes and changes (generate.ts, `catalogue`).
  derived("catalogue.working_day", "the profile's ordinary_hours_per_week over the round's working days (five without a round)"),
  prof("catalogue.travel.seconds_per_cell", "round.travel_seconds_per_cell"),
  prof("catalogue.structure_types.*.way.speed_kmh", "round.roads"),
  prof("catalogue.structure_types.*.way.capacity", "round.roads"),
  prof("travel.vehicle_types", "round"),
  prof("catalogue.travel.by_cover.*", "round.travel_by_cover"),
  derived("catalogue.body_variables.*.max", "the profile's education.max_years of schooling, as skill (a year is 10,000)"),
  conv("catalogue.body_variables", "skill counted from none: nobody is born schooled"),
  ...task("collect", [prof("labour", "services.collect_seconds_per_10kg"), conv("produces", "10 kg of waste a unit collected")]),
  ...task("maintain", [conv("labour", "an hour: the unit upkeep is counted in"), derived("changes", "the wear an hour of upkeep undoes: from services.asset_life_years and services.upkeep_hours_per_week_per_asset")]),
  ...task("repair", [conv("labour", "an hour: the unit a repair is counted in"), derived("changes", "the disrepair an hour puts right: the level of fault over frictions.repair_hours")]),
  ...task("survey", [derived("labour", "the profile's nature.survey_hours_per_ha over a cell's area")]),
  ...task("treat", [prof("labour", "health.consult_minutes"), prof("on_body.treats", "health.treats")]),
  ...task("teach", [prof("labour", "education.hours_per_day"), derived("on_body.changes", "a school day's share of a year's schooling: 10,000 over education.school_days_per_year")]),
  ...task("investigate", [prof("labour", "crime.investigation_hours"), prof("detection_bps", "crime.detection_bps")]),
  ...task("draw_water", [conv("labour", "the river's work: a kilolitre drawn takes no one in the town any time (the works' staff are counted as its own)"), conv("draws", "a kilolitre a unit drawn")]),
  ...task("consume", [conv("labour", "using things up is no one's work"), conv("consumes", "one item used up a unit")]),
  derived("catalogue.tasks.*.labour_by", "how much less time the most schooled take: the profile's education.return_per_year_bps, compounded (Mincer 1974)"),
  derived("catalogue.tasks.*.labour", "an item's time: the profile's industry labour share of its price at the wage (factory for make and the products, shop for serving and selling; industry, wages_per_pay_period), scaled to the mean adult's schooling; nought for using a kind up"),
  derived("catalogue.tasks.*.consumes", "an item's inputs: the profile's industry.factory_input_share_bps of its price at the input's price (prices); one of a kind for using it up"),
  conv("catalogue.tasks.*.produces", "one item a unit made: the town's own unit of what is made (docs/profiles.md)"),
  // The fields: pollution (nature), the river's water (utilities and hazards) and heat (climate), each from its own section.
  conv("catalogue.fields.*.min", "nothing below nought"),
  { ...prof("catalogue.fields.*.max", "climate.built_heat_units"), id: "heat", family: "catalogue.fields.max (heat)" },
  conv("catalogue.fields.*.max", "a ceiling far above anything a field reaches: a bound for the arithmetic, not a figure"),
  derived("catalogue.fields.*.source_by_day", "the weather, drawn from the profile's climate (rain on the river, heat on heatwave days), or the spec's"),
  { ...prof("catalogue.fields", "nature.pollution"), id: "pollution", family: "catalogue.fields (pollution)" },
  { ...prof("catalogue.fields.*.decay_bps_per_day", "utilities.water.river_decay_bps_per_day"), id: "water", family: "catalogue.fields (water)" },
  { ...prof("catalogue.fields.*.flow_bps_per_day", "utilities.water.river_flow_bps_per_day"), id: "water", family: "catalogue.fields (water)" },
  { ...prof("catalogue.fields.*.spills_above", "hazards.river_bank_kl"), id: "water", family: "catalogue.fields (water)" },
  { ...prof("catalogue.fields.*.spill_bps_per_day", "hazards.spill_bps_per_day"), id: "water", family: "catalogue.fields (water)" },
  { ...derived("catalogue.fields.*.from_covers", "the river's inflow a cell (utilities.water.river_inflow_kl_per_cell_per_day), and what a wetland soaks up (hazards.wetland_soak_kl_per_day)"), id: "water", family: "catalogue.fields (water)" },
  { ...placeholder("catalogue.fields.*.decay_bps_per_day", "half the heat lost a day: the generator's (generate.ts)"), id: "heat", family: "catalogue.fields (heat)" },
  { ...prof("catalogue.fields.*.from_covers", "climate"), id: "heat", family: "catalogue.fields (heat)" },
  // Offices' and firms' parameters (generate.ts, where each office is made), read only where the module runs.
  ...of("world.trade", [
    prof("terms_days", "business.trade_credit_days"),
    prof("price_process", "world_price_process"),
    { ...prof("sells.*", "prices.materials_per_kg"), id: "materials" },
    { ...prof("sells.*", "prices.inputs_per_kg"), id: "inputs" },
    { ...prof("sells.*", "utilities.energy.grid_price_per_kwh"), id: "energy" },
    derived("sells", "the world's prices: the goods price and its import markup (prices), a kind's wholesale price (the shop mix), a product's input price"),
    derived("buys", "what the world market buys of the town's goods: what the factories' opening staff make less what the town's shops sell, at the factory price"),
  ]),
  ...of("world.vendor", [
    derived("offers.*.seconds", "a person's time for the task (the town's make and serve times, or the table of work's row for the paper) at the offer's speed"),
    prof("offers", "automation"),
  ]),
  ...of("world.weather", [derived("events", "the weather's events, drawn by the generator from the profile's climate")]),
  ...of("world.migration", [
    prof("participation_bps", "labour_force_participation_bps"),
    prof("schooling.school_ages", "education.school_ages"),
    prof("schooling.attainment", "education.attainment"),
    conv("schooling.per_year", "a year of schooling counted as 10,000 of skill: the platform's unit"),
  ]),
  ...of("world.valuer", [derived("land_value", "the profile's public_finance.median_house_price less the builder's price of the commonest house")]),
  ...of("world.disposal", [prof("price_per_tonne", "services.landfill_levy_per_tonne")]),
  ...of("world.transfers", [placeholder("publish_every_days", "the support office's statistics published every 30 days: the generator's")]),
  ...of("world.statistics", [derived("population", "the town's head count at its start: the count the statistician begins from")]),
  ...of("city.mayor_code", [
    derived("population", "the town's adult count at its start"),
    prof("park_budget", "town_finance.parks_per_year"),
    placeholder("budget_lead_days", "how long before the year the budget is begun: 45 days, the council's vote and two weeks, the generator's (BUDGET_LEAD_DAYS)"),
    derived("road_budget", "the profile's round.roads.budget_per_resident by the town's count"),
    derived("staff_budget", "the works crew (services.council_staff_per_1000 of the town) a year at the construction wage"),
    derived("administration_budget", "the town's own administrative staff (public_service.staff_per_1000) a year at the public service wage"),
    derived("services_budget", "a year's waste (services.waste_per_person_per_day_g) at the landfill's charge (services.landfill_levy_per_tonne), and a fifth over"),
    derived("environment_budget", "the environment office's scientists (nature.survey_staff) a year at the construction wage"),
  ]),
  ...of("city.councillor", [placeholder("leaning", "the councillors' leanings, evenly from -80 to 80: the generator's (COUNCIL_LEANINGS)")]),
  ...of("city.inspector", [prof("fine", "town_finance.unpermitted_building_fine")]),
  ...of("city.works", [
    prof("collect_labour", "services.collect_seconds_per_10kg"),
    conv("collect_per_unit", "10 kg of waste, in grams: the unit collecting counts in"),
    conv("maintain_labour", "an hour: the unit upkeep is counted in"),
    derived("maintain_per_unit", "the wear an hour of upkeep undoes: from services.asset_life_years and services.upkeep_hours_per_week_per_asset"),
    derived("maintain_over", "a week's wear, from services.asset_life_years"),
    prof("wage", "wages_per_pay_period.construction"),
  ]),
  ...of("city.environment", [derived("survey_labour", "the profile's nature.survey_hours_per_ha over a cell's area"), prof("wage", "wages_per_pay_period.construction")]),
  ...["city.planning_officer", "city.rates_officer"].flatMap((m) => of(m, [
    prof("procurement", "automation.procurement"),
    derived("casework.person_seconds", "a person's seconds for the paper: the table of work's row (orchestration.act_time)"),
    derived("casework.wage_month", "a month of the public service wage (public_service.wage_per_pay_period)"),
    derived("casework.seconds_per_worker_month", "a month of working days (the working day, the round's days)"),
    placeholder("casework.utilisation_bps", "80% of a worker's hours spent on casework: the generator's"),
  ])),
  ...of("clinic.practice", [
    derived("doctors", "the profile's health.doctors_per_1000 of the town, at least one"),
    prof("consults", "health.treats"),
    prof("wage", "health.doctor_wage_per_pay_period"),
    derived("opens", "half an hour after the round's work starts (round.work_start_hour)"),
    prof("closes", "round.work_end_hour"),
  ]),
  ...of("school.principal", [
    derived("teachers", "the town's pupils over the profile's education.students_per_teacher, at least one"),
    prof("lesson_seconds", "education.hours_per_day"),
    derived("term_days", "a quarter of the profile's education.school_days_per_year, in calendar days"),
    prof("school_ages", "education.school_ages"),
    derived("starts", "half an hour after the round's school starts (round.school_start_hour)"),
    prof("wage", "education.teacher_wage_per_pay_period"),
  ]),
  ...of("body.payroll", [prof("wage", "public_service.wage_per_pay_period")]),
  ...of("police.station", [derived("officers", "the profile's crime.police_per_1000 of the town, at least one"), prof("wage", "crime.officer_wage_per_pay_period")]),
  ...of("city.electoral_office", [derived("term_days", "the profile's elections.term_years, in days")]),
  ...of("tribunal.member", [
    { ...prof("hearing_after_days", "frictions.venues.tribunal_days"), given: "dials.friction_bps" },
    prof("hearing_after_days", "justice.hearing_after_days"),
    prof("pay_within_days", "justice.pay_within_days"),
    prof("possession", "tenancy.possession"),
    derived("fee", "the profile's frictions.venues.tribunal_fee_hours_of_pay at the shop wage"),
    prof("hears.*.fee", "decisions"),
  ]),
  ...of("tribunal.registrar", [prof("warrant_days", "tenancy.possession"), prof("eviction_notice_days", "tenancy.possession")]),
  ...of("firm.landlord", [
    derived("possession", "the tribunal's fee for an application and a warrant: the profile's frictions.venues.tribunal_fee_hours_of_pay at the shop wage"),
    prof("base_rent.*.*.rent", "rents_per_month"),
    prof("base_rent.*.*.bedrooms", "rents_per_month"),
    placeholder("compliance_bps", "the share of the time landlords obey a refusal, fine or order: the spec's setting (worlds/town.yaml), not a figure of any place"),
    prof("rent_review_months", "tenancy"),
    prof("rent_increase_notice_days", "tenancy.rent_increase_notice_days"),
    prof("repair.units", "frictions.repair_hours"),
    derived("repair.price", "an hour of the construction wage (wages_per_pay_period.construction) with the builder's markup"),
  ]),
  ...of("firm.builder", [
    conv("repair_labour", "an hour: the unit a repair is counted in"),
    derived("repair_price", "an hour of the construction wage (wages_per_pay_period.construction) with the builder's markup"),
    placeholder("types", "buildings' materials and build and demolition times: the generator's, as catalogue.structure_types (docs/behaviour/generator.md)"),
    prof("wage", "wages_per_pay_period.construction"),
  ]),
  ...of("firm.producer", [
    derived("labour_per_unit", "an item's time at the factory: the profile's industry.factory_labour_share_bps of its price at the factory wage"),
    derived("per_unit", "an item's inputs: the profile's industry.factory_input_share_bps of its price at the input's price (prices)"),
    derived("price", "an item's price at the factory: its work's pay over the profile's industry.factory_labour_share_bps, or prices.goods_world"),
    prof("terms_days", "business.trade_credit_days"),
    prof("wage", "wages_per_pay_period.factory"),
  ]),
  ...of("firm.retailer", [
    derived("demand", "a shop's expected sales a month: the town's households' demand shared among its shops"),
    derived("max_staff", "the staff a shop's expected sales need at the shops' planned use of their hours"),
    conv("min_staff", "a business of one employs nobody"),
    derived("serve_labour", "the time to serve an item: the profile's industry.retail_labour_share_bps of its price at the shop wage"),
    derived("price", "a shop's price: the world's goods price over the profile's industry.retail_purchases_share_bps, or its kind's from the shop mix"),
    prof("stock_days", "employment.own_account"),
    prof("draw_days", "pay_period_days"),
    prof("wage", "wages_per_pay_period.shop"),
  ]),
  ...of("union.organiser", [
    prof("claim_margin_bps", "unions.claim_margin_bps"),
    prof("dues", "unions.dues_per_month"),
    prof("resignation_notice_days", "unions.resignation_notice_days"),
    derived("pay_per_day", "each industry's wage over the pay period's days (wages_per_pay_period, pay_period_days)"),
  ]),
  ...of("utility.water", [
    prof("price_per_kl", "utilities.water.price_per_kl"),
    prof("service_per_quarter", "utilities.water.service_per_quarter"),
  ]),
  ...of("utility.energy", [
    prof("price_per_unit", "utilities.energy.price_per_kwh"),
    prof("supply_per_day", "utilities.energy.supply_per_day"),
    prof("billing_over_bps", "frictions.bill_over_bps"),
  ]),
  ...of("bank.lending", [
    prof("rate_bps", "credit.lending_rate_bps"),
    prof("buffer_bps", "credit.serviceability_buffer_bps"),
    prof("max_share_bps", "credit.max_repayment_share_bps"),
    prof("reserve", "credit.reserve"),
    derived("funding_rate_bps", "the profile's credit.cash_rate_bps and credit.funding_spread_bps, added"),
    prof("mortgage_rate_bps", "ownership.mortgage_rate_bps"),
    prof("mortgage_max_months", "ownership.market.mortgage_months"),
    derived("max_lvr_bps", "all of a home's price less the profile's ownership.market.deposit_bps"),
  ]),
  ...of(CITIZEN, [
    derived("own_work.expect_per_month", "what someone trading on their own account is expected to clear a month: the town's custom shared among its sellers"),
    derived("started", "how long a person has lived in the town and worked in their trade, drawn from the profile's outlook.residence and outlook.job_tenure"),
  ]),
  // Parameters of the firms and the round, wherever they run.
  ...[
    prof("registered_bps", "employment.registered_bps"),
    prof("casual_bps", "employment.casual_bps"),
    prof("day_wage", "employment.day_wage"),
    prof("respond.grant_bps", "frictions.put_right_on_asking_bps"),
    prof("short_pay.by_bps", "frictions.pay_short_by_bps"),
    prof("values", "values"),
    derived("owner_values", "the values of the firm's principal holder, drawn from the profile's values"),
    prof("org.rise_bps", "outlook.asked.rise_granted_bps"),
    derived("look_at", "an hour after the round's work starts (round.work_start_hour)"),
    prof("look_days", "round.work_days"),
    { ...prof("work_days", "round.work_days"), given: "catalogue.travel" },
    prof("open_from", "round.work_start_hour"),
    prof("open_until", "round.work_end_hour"),
  ].flatMap((r) => ["participants.*.controller.params", "templates.*.controller.params", "positions.*.role_module.params"].map((at) => ({ ...r, family: `any module: ${r.at}${r.given ? ` (${r.given})` : ""}`, at: `${at}.${r.at}` }))),
  // Parameters several modules take, from the same sections of the profile.
  ...[
    derived("households.adult_age_bands", "the adults' ages by band, drawn to fit the profile's age structure and households (households.age_bands_bps and the households' kinds)"),
    prof("households", "households"),
    prof("savings_by_age", "savings_by_age"),
    prof("automation", "automation"),
    prof("adjust", "employment.adjustment"),
    derived("working_day", "the working day, from the profile's ordinary hours a week"),
    derived("per_resident_per_year", "the profile's grants or charges per resident, by the town's count"),
  ].flatMap((r) => ["participants.*.controller.params", "templates.*.controller.params", "positions.*.role_module.params"].map((at) => ({ ...r, family: `any module: ${r.at}`, at: `${at}.${r.at}` }))),
  // The network for what flows (foundations-2 C4, law 8; worlds/generator/network.ts): its engineering figures are the
  // profile's (`utilities.network`, stand-ins until sourced); capacities and lengths are made from them and the layout.
  derived("world.network.links.*.capacity", "a pipe's or a wire's capacity: what its users ask at the start, times the profile's peak (pipes) or margin over the peak hour (wires): utilities.network"),
  derived("world.network.links.*.length_m", "the distance on the ground between its nodes, by the generator's layout of districts"),
  prof("world.network.links.*.loss_m", "utilities.network"),
  derived("world.network.supplies.*.storage", "the works' store: the town's use at the start times the profile's storage_days (utilities.network)"),
  prof("world.network.supplies.*", "utilities.network"),
  derived("world.connections.*.rate", "a household's own use: the profile's litres a head times its people, and its kWh a day (utilities.water, utilities.energy); a sewer lets out what it holds"),
  prof("catalogue.resources.*.shape_bps", "utilities.network"),
  derived("catalogue.tasks.*.emits.*", "what a unit puts out: a kWh used, the grid's emissions (utilities.energy.grid_emissions_g_per_kwh); a kilolitre treated, a kilolitre put back on the land (the unit of the treatment)"),
  conv("catalogue.tasks.*.collects.per_unit", "a load of 10 kg, the unit the crew's time is reckoned in (services.collect_seconds_per_10kg)"),
  prof("catalogue.species", "nature.species"),
  prof("catalogue.land_covers", "nature.covers"),
  placeholder("catalogue.structure_types", "buildings' sizes, rooms and build times: the generator's (docs/behaviour/generator.md)"),
  placeholder("catalogue.variables", "a building's variables and their rates: the generator's, or the profile's where it gives them (WM-11)"),
  conv("knowing.keepers.*.answers.*.most", "how many a keeper answers at once: one thing at a time, the platform's design of knowing"),
  // A system template's own seconds, hours and lanes (law 10, foundations-2 P1 and P3): each with its source in act_time.sources, keyed
  // `template.<id>.<row>`. The casework desk's minutes are the person table's rows; an office offer's a share of them at its speed; a
  // machine's hours the whole day (software runs when asked); the desk's hours an officer's day and its lanes the town's share of officers.
  ...of("utility.water", [derived("storage", "the works' store: the town's use at the start times the profile's storage_days (utilities.network)")]),
  ...of(CITIZEN, [prof("utilities.water_l_a_head", "utilities.water.litres_per_person_per_day"), prof("utilities.energy_kwh_a_day", "utilities.energy.kwh_per_household_per_day")]),
  derived("templates.*.does.*.seconds", "a system's seconds for an act: a person's time for it at an offer's speed, or an officer's (the person table's row); act_time.sources template.<id>.<row>"),
  derived("templates.*.hours.from", "when a system's day begins: a machine's midnight (all day), or an officer's working day from the profile's round.work_start_hour"),
  derived("templates.*.hours.seconds", "how long a system's day is: a machine's whole day, or an officer's working day (ordinary_hours_per_week) times the town's share of officers; act_time.sources template.<id>.hours"),
  prof("participants.*.lanes", "public_service.support_officers_per_1000_claims"),
];
export { conv, derived, placeholder, prof };
