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
  // The generator's output for worlds/town.yaml at commit 750bc30, before starting attachment existed.
  expect(hash(c)).toBe("404b59db6235883233d93cbace46a47686d6c2ed95e8b559497612e7ad5f3cb9");
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
  expect(c.dials).toBeUndefined();
});

test("`living` with the starting attachment off gives no started; the initiative dial is written when given", () => {
  const c = generate({ ...small, living: { starting_attachment: false, initiative_bps: 2500 } }) as any;
  expect(JSON.stringify(c)).not.toContain('"started"');
  expect(params(c).every((p: any) => p.attach_mean !== undefined)).toBe(true);
  expect(c.dials).toEqual({ initiative_bps: 2500 });
});

test("a living town is deterministic and leaves every other draw as it was", () => {
  const a = generate({ ...small, living: {} }) as any, b = generate({ ...small, living: {} }) as any;
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  // (What a living town adds, and nothing else: people's starting attachments and the town's mean; firms' and
  // landlords' owners' values, the town's figures they are read against, what the profile says of asking, and the
  // posts that keep their records.)
  const strip = (c: any) => JSON.parse(JSON.stringify(c, function (this: any, k, v) {
    if (k === "started" || k === "attach_mean" || k === "keeps_record" || k === "owner_values" || k === "org") return undefined;
    // (The town's figures, given to a firm's module beside its owner's values: a firm's parameters name its premises, its works or its rents.)
    if (k === "values" && this && ("premises" in this || "works" in this || "base_rent" in this)) return undefined;
    return v;
  }));
  expect(strip(a)).toEqual(strip(generate(small)));
});
