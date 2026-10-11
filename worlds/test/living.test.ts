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
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");

test("a spec without `living` generates what it generated before (byte for byte)", () => {
  const c = generate(small);
  // The generator's output for worlds/town.yaml on origin/main at ab23f96 (generated there and compared, 2026-10-11),
  // which has no `living`. (At 750bc30, before starting attachment existed, it was 404b59db...; main's planning
  // form gained two fields since, and nothing else differs: this branch gave 404b59db... before merging that.)
  // Moved on purpose, 2026-10-11 (it was cef691ee...): every town's config gains its place's laws on ending a job
  // and on possession, how its firms adjust their staff, where a landlord's application for possession goes, the
  // venture of a business of one with its derived chance (and the task `sell`), and the generator's version; a
  // town whose profile has `frictions` and no `living` is otherwise unchanged (docs/decisions.md, "Four faults on
  // the firm and landlord side"). What this test guards is unchanged: nothing of `living` reaches such a town.
  expect(hash(c)).toBe("b52528bc6281ade671cfe4ecec95f8a2ab95edcdcfa354f94b4a6f3050ea88db");
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
  expect(module("firm.retailer")[0].short_pay.by_bps).toBe(F.pay_short_by_bps);
  expect(module("firm.landlord")[0].respond.grant_bps).toEqual(F.put_right_on_asking_bps);
  expect(module("firm.landlord")[0].repair.units).toBe(F.repair_hours);
  expect(module("firm.builder")[0].repair_task).toBe("repair");
  expect(module("utility.energy")[0].billing_error_bps_per_year).toBe(F.per_adult_bps_per_year.bill);
  expect(module("world.transfers")[0]).toMatchObject({ processing_days: F.support.processing_days, error_bps: F.support.wrong_refusal_bps });
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
