// Scenarios (docs/scenarios.md): named starting conditions, as data, applied by the generator. Here, quickly: every
// scenario reads, keeps to the rules and generates a valid town; the baseline is the town untouched; each changes what
// it says it changes; they go together as the doc says; and nothing of one is shown to anybody in the world.
// (Each one run for sixty days at 1,000 people: orchestrator/test/scenarios.test.ts.)

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Randomness } from "@oikos/participants";
import { generate, type TownSpec } from "../generator/generate";
import { loadProfile, PROFILE_DIR, type Profile } from "../generator/profile";
import { applyScenarios, checkScenario, loadScenario, namedScenarios, offeredScenarioIds, SCENARIO_DIR, scenarioIds, seasonStart, type Scenario } from "../generator/scenario";
import { drawWeather, weatherMeasure } from "../generator/weather";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec;
const YEAR = 365 * 86_400;
const ids = scenarioIds();
const base = generate(spec) as any;
const made = new Map<string, any>();
const town = (scenario: string): any => made.get(scenario) ?? (made.set(scenario, generate({ ...spec, scenario })), made.get(scenario));
// (An office's module parameters, whoever holds the post: a delivered system's controller, or a person's post module: foundations F5.)
const office = (c: any, id: string) => { const post = c.positions.find((p: any) => p.id === id); const holder = c.participants.find((p: any) => p.id === post?.holder); return holder?.kind === "system" ? holder.controller.params : post?.role_module?.params; };
const balance = (c: any, id: string) => Number(c.world.accounts.find((a: any) => a.id === id).balance);

test("every scenario reads, says its basis for every change, and generates a valid town", () => {
  expect(ids).toContain("baseline");
  expect(ids.length).toBeGreaterThanOrEqual(9);
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of ["common", "blocks", "records", "world-config", "participant-api", "log"]) ajv.addSchema(JSON.parse(readFileSync(join(root, `contracts/${f}.schema.json`), "utf8")));
  const valid = ajv.getSchema("urn:oikos:contracts:0.8:world-config")!;
  for (const id of ids) {
    const s = loadScenario(id);
    expect(s.id).toBe(id);
    for (const x of [...(s.changes ?? []), ...(s.season ? [s.season] : []), ...(s.weather ? [s.weather] : [])]) expect(x.basis.trim().length).toBeGreaterThan(10);
    const ok = valid(town(id));
    if (!ok) console.error(id, valid.errors?.slice(0, 5));
    expect(ok).toBe(true);
  }
  // The same description, the same town.
  for (const id of ["wet-year", "ageing-town"]) expect(JSON.stringify(generate({ ...spec, scenario: id }))).toBe(JSON.stringify(town(id)));
}, 120_000);

test("a scenario's file writes no currency and names no figure of a place's money", () => {
  for (const f of readdirSync(SCENARIO_DIR)) {
    expect(f).toMatch(/^[a-z][a-z0-9-]*\.yaml$/);
    const text = readFileSync(join(SCENARIO_DIR, f), "utf8");
    expect(/[$£€¥]|dollar|\bcents?\b|\bpounds?\b|\beuros?\b/i.exec(text)?.[0]).toBeUndefined();
  }
});

test("no scenario, and the baseline, are the town exactly as it was", () => {
  const plain = JSON.stringify(base);
  expect(JSON.stringify(town("baseline"))).toBe(plain);
  expect(JSON.stringify(generate({ ...spec, scenario: [] }))).toBe(plain);
  // (And nothing is copied or shifted on the way: the description and profile handed back are those handed in.)
  const P = loadProfile(spec.profile!);
  const under = applyScenarios({ ...spec, scenario: "baseline" }, P);
  expect(under.profile).toBe(P);
  expect(under.applied).toEqual([]);
  // The baseline named with another changes nothing of the other.
  expect(JSON.stringify(generate({ ...spec, scenario: "baseline+lean-council" }))).toBe(JSON.stringify(town("lean-council")));
}, 120_000);

test("the rules: for any place, from the first day, and only what a scenario may change", () => {
  const ok: Scenario = { id: "x", about: "A test.", bears_on: [], changes: [{ in: "profile", path: "opening.town", times_bps: 5000, basis: "A placeholder for the test." }] };
  expect(() => checkScenario(ok)).not.toThrow();
  const wrong = (s: object, why: RegExp) => expect(() => checkScenario({ ...ok, ...s } as Scenario)).toThrow(why);
  const change = (c: object) => ({ changes: [{ basis: "A placeholder for the test.", ...c }] });
  // No basis.
  wrong({ changes: [{ in: "profile", path: "opening.town", times_bps: 5000 }] }, /no basis/);
  // A place's money can't be set outright, only taken a multiple of; nor its currency touched.
  wrong(change({ in: "profile", path: "opening.town", set: 100 }), /multiple of the profile's own/);
  wrong(change({ in: "profile", path: "support.pension.amount", set: 0 }), /multiple of the profile's own/);
  wrong(change({ in: "profile", path: "currency.minor_units", times_bps: 5000 }), /money/);
  expect(() => checkScenario({ ...ok, ...change({ in: "profile", path: "crime.detection_bps", set: 1000 }) } as Scenario)).not.toThrow();
  // The world market's conditions hold from the first day: a later one is an event made to happen.
  wrong(change({ in: "town", path: "shocks", add: { from_day: 30, kind: "goods", what: "demand", factor_bps: 5000 } }), /event made to happen/);
  // Not the town's name, seed, size, profile, wages or weather.
  for (const path of ["seed", "name", "citizens", "profile", "wages", "weather", "exports_per_month", "landlord_capital", "model_seats", "mayor", "start_month"]) wrong(change({ in: "town", path, set: 1 }), /may not change a town's/);
  wrong(change({ in: "town", path: "houses", set: 10 }), /only be changed by times_bps/);
  // One thing a change, and nothing a scenario doesn't have.
  wrong(change({ in: "profile", path: "opening.town", times_bps: 5000, shortfall_times_bps: 1 }), /exactly one/);
  wrong({ on_day: 20 }, /nothing a scenario has/);
  wrong({ weather: { rank_by: "inflow", percentile: 101, draws: 9, over_days: 30, basis: "A placeholder for the test." } }, /percentile/);
  expect(() => loadScenario("no-such")).toThrow(/no scenario "no-such"/);
  expect(() => generate({ ...spec, scenario: "no-such" })).toThrow(/no scenario/);
});

test("each scenario changes what it says it changes", () => {
  const P = loadProfile(spec.profile!).values;
  // An election due: polling day sixty days in.
  expect(office(base, "electoral").first_poll_day).toBe(365);
  expect(office(town("election-due"), "electoral").first_poll_day).toBe(60);
  // A lean council: a hundredth of the opening balance, half the grants; nobody else's money moved.
  const lean = town("lean-council");
  expect(balance(lean, "acc-city")).toBe(Math.round(P.opening.town / 100));
  expect(office(lean, "outside-grants").per_resident_per_year).toBe(Math.round(P.public_finance.grants_per_resident_per_year / 2));
  expect(balance(lean, "acc-bank")).toBe(balance(base, "acc-bank"));
  // An export slump: the world takes a quarter less from the first day; what a factory has in hand is as it was (derived).
  const slump = town("export-slump");
  expect(office(slump, "outside-trade").shocks).toEqual([{ from_day: 0, kind: "goods", what: "demand", factor_bps: 7500 }]);
  expect(office(base, "outside-trade").shocks).toEqual([]);
  expect(balance(slump, "acc-factory-1")).toBe(balance(base, "acc-factory-1"));
  expect(office(slump, "outside-trade").buys).toEqual(office(base, "outside-trade").buys); // (the demand itself is the profile's still)
  // Dear energy: the grid's price doubled from the first day.
  expect(office(town("energy-price-shock"), "outside-trade").shocks).toEqual([{ from_day: 0, kind: "energy", what: "price", factor_bps: 20_000 }]);
  // A jobs slump: twice as many of the labour force without a job.
  const jobs = (c: any) => c.world.records.filter((r: any) => r.record === "agreement" && r.terms?.template === "employment").length;
  const under = applyScenarios({ ...spec, scenario: "jobs-slump" }, loadProfile(spec.profile!));
  expect(under.town.employed_bps).toBe(10_000 - 2 * (10_000 - spec.employed_bps));
  // Fewer jobs for it, over several towns. (Who has a job is a draw for each person, and the further five in a hundred
  // the slump puts out of work may fall on nobody in one small town: it did in the town drawn from this spec's own
  // seed after the ages fixes of 2026-10-08, 82 jobs either way, where this had been "fewer than the plain town's".)
  // (Twelve towns, not three: a town under the slump is not the plain town with fewer jobs but another draw of it,
  // because the first person the slump leaves without a job has no pay day drawn, and everyone after them is drawn
  // differently. So the two differ by chance as well as by the slump: with people stopping work at ages of their
  // own, three towns came to 262 jobs plain and 267 under the slump; twelve come to 1,055 and 1,011.)
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const plains = seeds.map((seed) => generate({ ...spec, seed }) as any);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  expect(sum(seeds.map((seed) => jobs(generate({ ...spec, seed, scenario: "jobs-slump" }))))).toBeLessThan(sum(plains.map(jobs)));
  // An ageing town: the share aged 65 and over is what half as many again in those bands comes to.
  const over65 = (c: any) => { const p = c.world.entities.filter((e: any) => e.kind === "person"); return p.filter((e: any) => -e.born_at >= 65 * YEAR).length / p.length; };
  const census = P.households.age_bands_bps!;
  const old = census.filter((b) => b.from >= 65).reduce((a, b) => a + b.bps, 0), all = census.reduce((a, b) => a + b.bps, 0);
  const expected = (1.5 * old) / (all + 0.5 * old);
  expect(Math.abs(over65(town("ageing-town")) - expected)).toBeLessThan(0.07);
  // And older than the plain town, held over several towns against what each should be: the plain ones the census's
  // own share, the ageing ones the share above. (This was "more than 1.15 times the plain town's", one town against
  // one; a town of 200 is a draw, and the plain town drawn from this spec's seed since the ages fixes of 2026-10-08 is
  // an old one, 29% of it 65 and over where the census has 22%.)
  const plainShare = sum(plains.map(over65)) / seeds.length, ageingShare = sum(seeds.map((seed) => over65(generate({ ...spec, seed, scenario: "ageing-town" })))) / seeds.length;
  expect(ageingShare).toBeGreaterThan(plainShare);
  expect(Math.abs(plainShare - old / all)).toBeLessThan(0.04);
  expect(Math.abs(ageingShare - expected)).toBeLessThan(0.04);
  // A housing shortage: a tenth fewer houses and blocks, for the same people.
  const homes = (c: any) => c.world.structures.filter((s: any) => /^(house|apts)-/.test(s.id)).length;
  expect(homes(town("housing-shortage"))).toBe(Math.round(spec.houses * 0.9) + Math.round(spec.apartment_blocks * 0.9));
  expect(town("housing-shortage").world.entities.filter((e: any) => e.kind === "person").length).toBe(base.world.entities.filter((e: any) => e.kind === "person").length);
  // Dirty industry: each factory's pollution two and a half times the profile's; the farmland's as it was.
  const pollution = (c: any) => c.catalogue.fields.find((f: any) => f.id === "pollution");
  expect(pollution(town("dirty-industry")).from_structures.factory).toBe(Math.round(P.nature!.pollution.per_factory_per_day * 2.5));
  expect(pollution(town("dirty-industry")).from_covers).toEqual(pollution(base).from_covers);
  // Fewer doctors and officers for the town's size (the figure each establishment is reckoned from; a small town's
  // rounds up to the same one doctor: the 1,000-person test counts them).
  const fig = (id: string) => applyScenarios({ ...spec, scenario: id }, loadProfile(spec.profile!)).profile.values;
  expect(fig("doctor-shortage").health!.doctors_per_1000).toBeCloseTo(P.health!.doctors_per_1000 / 2, 4);
  expect(fig("police-understrength").crime!.police_per_1000).toBeCloseTo(P.crime!.police_per_1000 * 0.86, 4);
  // Dear rents: every rent a quarter higher; wages as they were.
  expect(fig("dear-rents").rents_per_month.apartment_units.map((u) => u.rent)).toEqual(P.rents_per_month.apartment_units.map((u) => Math.round(u.rent * 1.25)));
  expect(fig("dear-rents").rents_per_month.house_types.map((u) => u.rent)).toEqual(P.rents_per_month.house_types.map((u) => Math.round(u.rent * 1.25)));
  expect(fig("dear-rents").wages_per_pay_period).toEqual(P.wages_per_pay_period);
  // Every other scenario leaves a figure it doesn't name alone.
  expect(fig("doctor-shortage").crime).toEqual(P.crime);
}, 120_000);

test("the weather of a wet, a dry and a hot year is the climate's own year at its place among the draws", () => {
  const C = loadProfile(spec.profile!).values.climate!;
  const days = spec.years * 365 + 1;
  for (const seed of [1, 2]) {
    const R = new Randomness(BigInt(seed));
    const plain = seed === spec.seed ? base : (generate({ ...spec, seed }) as any);
    for (const id of ["wet-year", "dry-year", "hot-summer"]) {
      const s = loadScenario(id), w = s.weather!;
      const month = seasonStart(C, s.season!.starts_in);
      const c = seed === spec.seed ? town(id) : (generate({ ...spec, seed, scenario: id }) as any);
      // What the run is given: the river's inflow by day, the heat, and the bureau's events.
      const rain = c.catalogue.fields.find((f: any) => f.id === "water").source_by_day, heat = c.catalogue.fields.find((f: any) => f.id === "heat").source_by_day;
      const measure = weatherMeasure({ rain, heat }, w.rank_by, w.over_days);
      // Drawn again here: the year given is one of them, whole, and stands where its percentile says.
      const draws = Array.from({ length: w.draws }, (_, i) => { const r = R.stream(["generator", `weather-${i + 1}`]); return drawWeather(C, days, (n) => r.below(n), month); });
      const given = draws.filter((d) => JSON.stringify(d.rain) === JSON.stringify(rain) && JSON.stringify(d.heat) === JSON.stringify(heat));
      expect(given.length).toBeGreaterThanOrEqual(1);
      expect(office(c, "weather-bureau").events).toEqual(given[0]!.events);
      const below = draws.filter((d) => weatherMeasure(d, w.rank_by, w.over_days) < measure).length, above = draws.filter((d) => weatherMeasure(d, w.rank_by, w.over_days) > measure).length;
      const place = Math.round((w.percentile * (w.draws - 1)) / 100);
      expect(below).toBeLessThanOrEqual(place);
      expect(above).toBeLessThanOrEqual(w.draws - 1 - place);
      // Nothing else of the town is drawn differently for it: the same people, homes and jobs as the plain town's.
      expect(JSON.stringify(c.world.entities)).toBe(JSON.stringify(plain.world.entities));
      expect(JSON.stringify(c.world.accounts)).toBe(JSON.stringify(plain.world.accounts));
    }
  }
  // The seasons, by the climate: the six months that bring the river most and least, and the first hot month.
  const half = (m: number) => Array.from({ length: 6 }, (_, k) => C.rain_by_month_bps[(m - 1 + k) % 12]!).reduce((a, b) => a + b, 0);
  for (let m = 1; m <= 12; m++) {
    expect(half(seasonStart(C, "wet_half"))).toBeGreaterThanOrEqual(half(m));
    expect(half(seasonStart(C, "dry_half"))).toBeLessThanOrEqual(half(m));
  }
  expect(C.summer_months).toContain(seasonStart(C, "hot_months"));
  expect(C.summer_months).not.toContain(((seasonStart(C, "hot_months") + 10) % 12) + 1);
}, 120_000);

test("scenarios go together in the order named: multiples multiply, and two that can't both hold are refused", () => {
  expect(namedScenarios("wet-year+lean-council")).toEqual(["wet-year", "lean-council"]);
  expect(namedScenarios("wet-year, lean-council")).toEqual(["wet-year", "lean-council"]);
  expect(namedScenarios(["a", "b"])).toEqual(["a", "b"]);
  expect(namedScenarios(undefined)).toEqual([]);
  const P = loadProfile(spec.profile!).values;
  const both = generate({ ...spec, scenario: ["wet-year", "lean-council"] }) as any;
  expect(balance(both, "acc-city")).toBe(Math.round(P.opening.town / 100));
  expect(JSON.stringify(office(both, "weather-bureau").events)).toBe(JSON.stringify(office(town("wet-year"), "weather-bureau").events));
  expect(both.meta.description).toEndWith("Starting conditions: wet-year, lean-council.");
  // The same one twice: a hundredth of a hundredth.
  expect(balance(generate({ ...spec, scenario: "lean-council+lean-council" }) as any, "acc-city")).toBe(Math.round(Math.round(P.opening.town / 100) / 100));
  // Two years of weather, two seasons.
  expect(() => generate({ ...spec, scenario: "wet-year+dry-year" })).toThrow(/don't go together/);
  expect(() => generate({ ...spec, scenario: "hot-summer+wet-year" })).toThrow(/don't go together/);
  // Every pair that isn't two weathers goes together.
  const noWeather = ids.filter((id) => !loadScenario(id).weather);
  expect(() => applyScenarios({ ...spec, scenario: noWeather }, loadProfile(spec.profile!))).not.toThrow();
}, 120_000);

test("nothing of a scenario is shown to anyone in the world: its name and words are in the description of the run only", () => {
  for (const id of ids.filter((x) => x !== "baseline")) {
    const c = town(id);
    expect(c.meta.description).toEndWith(`Starting conditions: ${id}.`);
    const world = JSON.stringify({ ...c, meta: undefined });
    expect(world.includes(id)).toBe(false);
    expect(/scenario|starting conditions/i.test(world)).toBe(false);
    expect(world.includes(loadScenario(id).about)).toBe(false);
  }
  expect(base.meta.description).not.toContain("Starting conditions");
});

test("an inert scenario says what is missing, can still be named, and is left out of those offered", () => {
  const ok: Scenario = { id: "x", about: "A test.", bears_on: [], changes: [{ in: "profile", path: "opening.town", times_bps: 5000, basis: "A placeholder for the test." }] };
  expect(() => checkScenario({ ...ok, status: "inert" })).toThrow(/inert_because/);
  expect(() => checkScenario({ ...ok, inert_because: "Nothing reports it." })).toThrow(/inert_because/);
  expect(() => checkScenario({ ...ok, status: "weak" as "inert", inert_because: "Nothing reports it." })).toThrow(/status/);
  expect(() => checkScenario({ ...ok, status: "inert", inert_because: "Nothing reports it." })).not.toThrow();
  const inert = ids.filter((id) => loadScenario(id).status === "inert");
  expect(inert.length).toBeGreaterThan(0);
  expect(offeredScenarioIds()).toEqual(ids.filter((id) => !inert.includes(id)));
  expect(offeredScenarioIds()).toContain("baseline");
  // Named, an inert one is applied like any other.
  expect(town(inert[0]!).meta.description).toEndWith(`Starting conditions: ${inert[0]}.`);
});

// (Each scenario generated from each profile, one by one: orchestrator/test/scenarios.test.ts. Here, quickly: each is
// applied to each profile's figures, which is where a profile that doesn't describe a thing is found out; and each
// profile's town is generated once under all that apply to it together.)
test("every scenario applies to every profile, or says what the profile doesn't describe; each profile's town generates under them together", () => {
  for (const f of readdirSync(PROFILE_DIR).filter((x) => x.endsWith(".json"))) {
    const P = JSON.parse(readFileSync(join(PROFILE_DIR, f), "utf8")) as Profile;
    const applies: string[] = [];
    for (const id of ids) {
      try {
        expect(applyScenarios({ ...spec, profile: P.id, scenario: id }, P).applied).toEqual(loadScenario(id).changes?.length || loadScenario(id).season || loadScenario(id).weather || loadScenario(id).capability ? [id] : []);
        applies.push(id);
      } catch (e) {
        expect(String(e)).toMatch(new RegExp(`scenario ${id}: the profile ${P.id} has no `));
      }
    }
    expect(applies.length).toBeGreaterThan(ids.length / 2);
    const together = applies.filter((id) => !loadScenario(id).weather);
    expect((generate({ ...spec, profile: P.id, scenario: together }) as any).participants.length).toBeGreaterThan(0);
  }
}, 240_000);
