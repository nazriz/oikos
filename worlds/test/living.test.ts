// Starting attachment (docs/profiles.md, "Length of residence and job tenure"): the profiles' bands of years, and the
// generator's use of them for a town whose spec has a `living` section. A town without one is generated as it always was.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, type TownSpec } from "../generator/generate";
import { loadProfile, PROFILE_DIR, tenureBandProblems } from "../generator/profile";

const root = join(import.meta.dir, "../..");
const read = (f: string) => Bun.YAML.parse(readFileSync(join(root, f), "utf8")) as TownSpec;
const small = read("worlds/town.yaml");
const big = read("worlds/town-1000.yaml");
const ids = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

test("every profile states residence and job tenure bands that are well formed, with a source or a marked placeholder", () => {
  expect(ids.length).toBe(9);
  for (const id of ids) {
    const p = loadProfile(id), O = p.values.outlook!;
    for (const k of ["residence", "job_tenure"] as const) {
      expect(tenureBandProblems(O[k]), `${id} ${k}`).toEqual([]);
      const source = (p as any).sources[`outlook.${k}`] as string;
      expect(source, `${id} ${k} source`).toBeTruthy();
      if (O[k]!.placeholder) expect(source.startsWith("PLACEHOLDER:"), `${id} ${k}`).toBe(true);
      else expect(source.length).toBeGreaterThan(200);
    }
    if (O.group_years) expect(tenureBandProblems(O.group_years)).toEqual([]);
  }
  expect(tenureBandProblems({ bands: [{ under_years: 2, bps: 5000 }, { under_years: 1, bps: 4000 }, { bps: 1000 }] })).not.toEqual([]);
  expect(tenureBandProblems({ bands: [{ under_years: 1, bps: 5000 }, { bps: 4000 }] })).not.toEqual([]);
  expect(tenureBandProblems({ bands: [{ under_years: 1, bps: 5000 }, { under_years: 2, bps: 5000 }] })).not.toEqual([]);
});

const params = (c: any) => c.participants.filter((p: any) => p.kind === "person").map((p: any) => p.controller.params ?? {});

test("a spec without `living` generates a town with nothing of `living` in it", () => {
  const c = generate(small);
  // (Until 2026-10-17 the generated config's hash was pinned here, and re-taken at nearly every generator change
  // (twenty times); orchestrator/test/culture-dial.test.ts pins the same config (CONFIG_BEFORE). What it stood for is
  // what follows: nothing of `living` reaches a town without it. docs/testing.md, "Change detectors".)
  const text = JSON.stringify(c);
  expect(text).not.toContain('"started"');
  expect(text).not.toContain("attach_mean");
  expect(c.dials).toBeUndefined();
});

test("a living town: the housed have a place, the employed a trade, children neither; ages cap them; the shares are the profile's", () => {
  const c = generate({ ...big, living: {} }) as any;
  const O = loadProfile(big.profile!).values.outlook!;
  const people = c.participants.filter((p: any) => p.kind === "person");
  const born = new Map<string, number>(c.world.entities.filter((e: any) => e.born_at !== undefined).map((e: any) => [e.id, e.born_at]));
  let place = 0, trade = 0;
  const placeYears: number[] = [], tradeYears: number[] = [];
  for (const p of people) {
    const s = p.controller.params?.started;
    expect(p.controller.params?.attach_mean?.place_bps).toBeGreaterThan(0);
    if (!s) continue;
    const age = (-(born.get(p.person) ?? NaN)) / 86_400;
    expect(Number.isNaN(age)).toBe(false);
    expect(age).toBeGreaterThanOrEqual(18 * 365);
    expect(Number.isInteger(s.place_days ?? 0)).toBe(true);
    if (s.place_days !== undefined) { place++; expect(s.place_days).toBeLessThanOrEqual(age); placeYears.push(s.place_days / 365); }
    if (s.trade_days !== undefined) { trade++; expect(s.trade_days).toBeLessThanOrEqual(age - 15 * 365); tradeYears.push(s.trade_days / 365); }
    expect(s.group_days).toBeUndefined(); // (no profile states group_years)
  }
  expect(place).toBeGreaterThan(300);
  expect(trade).toBeGreaterThan(100);
  const share = (xs: number[], lo: number, hi: number) => (xs.filter((y) => y >= lo && y < hi).length * 10_000) / xs.length;
  // (Against the first and the last band: the age caps pull the shares towards shorter times, so the margin is wide.)
  expect(Math.abs(share(placeYears, 0, 1) - O.residence!.bands[0]!.bps)).toBeLessThan(700);
  expect(Math.abs(share(tradeYears, 0, 1) - O.job_tenure!.bands[0]!.bps)).toBeLessThan(700);
  expect(share(tradeYears, 10, 1e9)).toBeGreaterThan(O.job_tenure!.bands.at(-1)!.bps * 0.4);
  // (No initiative dial given: none written. What goes wrong goes wrong at the profile's rates unless the spec says.)
  expect(c.dials).toEqual({ friction_bps: 10_000 });
});

test("the support office's books carry what it has answered, so that a request or a venue's notice it has answered is not open (pilot 7: complaints answered stood open for 12 days)", () => {
  const c = generate({ ...small, living: {} }) as any;
  const kinds = JSON.stringify(c).match(/"id":"reviews","kind":"records","way":"mine","match":\{"statement_kinds":\[([^\]]*)\]/)![1]!;
  for (const k of ["remedy_answer", "complaint_response", "tribunal_response"]) expect(kinds).toContain(`"${k}"`);
});

test("`living` with the starting attachment off gives no started; the initiative dial is written when given", () => {
  const c = generate({ ...small, living: { starting_attachment: false, initiative_bps: 2500 } }) as any;
  expect(JSON.stringify(c)).not.toContain('"started"');
  expect(params(c).every((p: any) => p.attach_mean !== undefined)).toBe(true);
  expect(c.dials).toEqual({ initiative_bps: 2500, friction_bps: 10_000 });
});

test("a living town is deterministic and leaves every other draw as it was", () => {
  // (With the friction dial at 0: what goes wrong is the test below's.)
  const a = generate({ ...small, living: { friction_bps: 0 } }) as any, b = generate({ ...small, living: { friction_bps: 0 } }) as any;
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a.dials).toBeUndefined();
  // (What a living town adds, and nothing else: people's starting attachments and the town's mean; firms' and
  // landlords' owners' values, the town's figures they are read against, what the profile says of asking, and the
  // posts that keep their records.)
  const strip = (c: any) => JSON.parse(JSON.stringify(c, function (this: any, k, v) {
    // (And, since step 2b: what holds people in a job and how fast belief fades in a living town, where the profile says.)
    if (k === "started" || k === "attach_mean" || k === "keeps_record" || k === "owner_values" || k === "org" || k === "job_move" || k === "belief") return undefined;
    // (The town's figures, given to a firm's module beside its owner's values: a firm's parameters name its premises, its works or its rents.)
    if (k === "values" && this && ("premises" in this || "works" in this || "base_rent" in this)) return undefined;
    return v;
  }));
  expect(strip(a)).toEqual(strip(generate(small)));
});

test("a living town where things go wrong (docs/behaviour/frictions.md): homes wear from where each starts, the builder repairs, bodies say what they hear, and each organisation has its rates from the profile; at the dial's 0 none of it", () => {
  const c = generate({ ...small, living: {} }) as any;
  const F = loadProfile(small.profile!).values.frictions!;
  const disrepair = c.catalogue.variables.find((v: any) => v.id === "disrepair");
  expect(disrepair.per_day).toBeGreaterThan(0);
  expect(c.catalogue.tasks.find((t: any) => t.id === "repair").changes.disrepair * F.repair_hours).toBeLessThanOrEqual(-50_000);
  const homes = c.world.structures.filter((x: any) => disrepair.types.includes(x.type));
  expect(homes.every((x: any) => x.variables.disrepair >= 0 && x.variables.disrepair < 50_000)).toBe(true);
  expect(new Set(homes.map((x: any) => x.variables.disrepair)).size).toBeGreaterThan(homes.length / 2);
  expect(c.world.structures.filter((x: any) => !disrepair.types.includes(x.type)).every((x: any) => x.variables === undefined)).toBe(true);
  const module = (code: string) => c.positions.filter((x: any) => x.role_module?.code === code).map((x: any) => x.role_module.params);
  expect(module("office.desk").map((p: any) => p.hears.map((h: any) => h.about))).toEqual([["bill", "claim_refused"], ["goods"], ["disrepair"]]);
  expect(module("tribunal.member")[0].hears.map((h: any) => h.about)).toEqual(["disrepair", "underpaid", "goods", "bill", "arrears", "claim_refused", "possession"]);
  expect(module("tribunal.member")[0].hearing_after_days).toBe(F.venues.tribunal_days);
  expect(module("union.organiser")[0].hears).toEqual([{ about: "underpaid" }]);
  expect(module("firm.landlord")[0].respond.grant_bps).toEqual(F.put_right_on_asking_bps);
  expect(module("firm.landlord")[0].repair.units).toBe(F.repair_hours);
  expect(module("firm.builder")[0].repair_task).toBe("repair");
  // (How often things go wrong is the world's table of slips, with the profile's notes as sources: foundations F7.)
  expect(c.orchestration.slip.person["publish/invoice/metered_bill"]).toEqual({ bps: F.per_adult_bps_per_year.bill, per: "year", friction: true });
  expect(c.orchestration.slip.person["publish/benefit_decision"]).toEqual({ bps: F.support.wrong_refusal_bps, friction: true });
  expect(c.orchestration.slip.person["publish/venue_decision"]).toEqual({ bps: F.venues.uphold_without_proof_bps });
  expect(module("firm.retailer")[0].short_pay).toEqual({ by_bps: F.pay_short_by_bps });
  expect(c.knowing.published.some((x: any) => x.what === "has:hears")).toBe(true);
  expect(c.participants.find((x: any) => x.controller?.impl === "citizen.default").channels.some((ch: any) => ch.match?.has?.includes("hears"))).toBe(true);
  // Twice as much goes wrong: the dial says so, and a home wears twice as fast.
  const twice = generate({ ...small, living: { friction_bps: 20_000 } }) as any;
  expect(twice.dials).toEqual({ friction_bps: 20_000 });
  expect(twice.catalogue.variables.find((v: any) => v.id === "disrepair").per_day).toBeGreaterThanOrEqual(2 * disrepair.per_day - 1);
  // Nothing of the kind: no variable, no venue, no dial.
  const none = JSON.stringify(generate({ ...small, living: { friction_bps: 0 } }));
  for (const word of ["disrepair", "office.desk", "ombudsman", "short_pay", "friction_bps", "has:hears", "billing_error"]) expect(none).not.toContain(word);
});

test("founding (docs/behaviour/founding.md): only a town that turns it on has any of it; then the dial, the profile's sizes as time at ordinary pay, the post a founder holds, and the one kind it publishes; every profile states its figures with their sources", () => {
  const off = generate({ ...small, living: {} }) as any;
  expect(off.dials.founding).toBeUndefined();
  expect(JSON.stringify(off)).not.toContain("group.founded");
  const c = generate({ ...small, living: { founding: true } }) as any;
  expect(c.dials.founding).toEqual({ shapes: ["gathering", "fund", "cause", "business"], scale_bps: 10_000 });
  expect(c.dials.composer).toBeUndefined();
  const F = loadProfile(small.profile!).values.founding!;
  const person = c.participants.find((x: any) => x.controller?.impl === "citizen.default");
  const f = person.controller.params.founding;
  expect(f.chance_bps).toBe(F.chance_bps);
  expect(f.dues).toHaveLength(F.dues_minutes_of_pay.length);
  expect(f.dues[0]).toBe(0);
  expect(f.dues.every((d: number, i: number) => Number.isInteger(d) && (i === 0 || d > f.dues[i - 1]))).toBe(true);
  expect(f.hall).toMatchObject({ space: "town-hall/hall.1", town: "city", account: "acc-city" });
  expect(f.hall.hire).toBeGreaterThan(f.dues.at(-1));
  expect(f.template).toMatchObject({ kind: "group", title: "Convenor", role_module: { code: "group.founded", keeps_record: true } });
  expect(person.channels.some((ch: any) => ch.id === "memberships" && ch.way === "published")).toBe(true);
  expect(c.knowing.published.some((x: any) => x.what === "membership")).toBe(true);
  // The dial's parts, and the composer's: which shapes, a scale, a study's own number of sharers; the mix and the cap.
  const some = generate({ ...small, living: { founding: { shapes: "gathering,cause", scale_bps: 20_000, shared_min: 1 }, composer: { pieces_per_month: 3 } } }) as any;
  expect(some.dials.founding).toEqual({ shapes: ["gathering", "cause"], scale_bps: 20_000 });
  expect(some.participants.find((x: any) => x.controller?.impl === "citizen.default").controller.params.founding.shared_min).toBe(1);
  expect(some.dials.composer).toEqual({ pieces_per_month: 3, mix: [{ model: "claude-code/claude-sonnet-5-5", share_bps: 5_000 }, { model: "codex/gpt-6.1-sol", share_bps: 5_000 }], fallback: "claude-code/claude-sonnet-5-5", follow_up_bps: 2_500 });
  expect(() => generate({ ...small, living: { composer: true } })).toThrow(/needs living.founding/);
  // Every profile: the registered rate with its source, the multiple marked a placeholder, the chance marked fitted or not.
  for (const id of ["au-vic-2026", "gb-eng-2026", "us-oh-2026", "de-ni-2026", "jp-akita-2026", "br-mg-2026", "mx-jal-2026", "in-tn-2026", "ke-nakuru-2026"]) {
    const p = loadProfile(id) as any;
    expect(p.values.founding.chance_bps).toBeGreaterThan(0);
    expect(p.values.founding.registered_per_100000_per_year).toBeGreaterThan(0);
    for (const k of ["founding", "founding.registered_per_100000_per_year", "founding.informal_multiple", "founding.chance_bps", "founding.sizes"]) expect(typeof p.sources[k]).toBe("string");
    expect(p.sources["founding.informal_multiple"]).toContain("PLACEHOLDER");
    expect(p.sources["founding.chance_bps"]).toMatch(/^(FITTED|NOT FITTED)/);
  }
});
