import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, type TownSpec } from "../generator/generate";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec;

test("the generated town is a valid v0.4 world config", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of ["common", "blocks", "records", "world-config", "participant-api", "log"]) ajv.addSchema(JSON.parse(readFileSync(join(root, `contracts/${f}.schema.json`), "utf8")));
  const v = ajv.getSchema("urn:oikos:contracts:0.8:world-config")!;
  const ok = v(generate(spec));
  if (!ok) console.error(v.errors?.slice(0, 5));
  expect(ok).toBe(true);
});

test("generation is deterministic from the seed", () => {
  expect(JSON.stringify(generate(spec))).toBe(JSON.stringify(generate(spec)));
  expect(JSON.stringify(generate({ ...spec, seed: 2 }))).not.toBe(JSON.stringify(generate(spec)));
});

// Who owns firms (docs/behaviour/firm-ownership.md): until 2026-10-08 every household held shares in every firm.
// A town has no retirement fund unless its description asks for one (retirement_fund: true): both are checked.
test("a firm is held by its owners, from outside, or widely: never by every household", () => {
  const big = Bun.YAML.parse(readFileSync(join(root, "worlds/town-1000.yaml"), "utf8")) as TownSpec;
  for (const s of [spec, big, { ...spec, retirement_fund: true }, { ...big, retirement_fund: true }]) {
    const config = generate(s) as any;
    const values = JSON.parse(readFileSync(join(root, `worlds/profiles/${s.profile}.json`), "utf8")).values;
    const profile = values.firm_ownership;
    const withFund = s.retirement_fund === true;
    // Nothing of a fund where none was asked for: no organisation, account, office, register or holding.
    expect(config.world.entities.some((e: any) => e.id === "fund" || e.kind === "retirement_fund")).toBe(withFund);
    expect(config.world.accounts.some((a: any) => a.holder === "fund")).toBe(withFund);
    expect(config.positions.some((p: any) => p.entity === "fund")).toBe(withFund);
    expect(config.world.records.some((r: any) => r.kind === "fund_members")).toBe(withFund);
    expect(JSON.stringify(config).includes("fund.retirement")).toBe(withFund);
    const registers = config.world.records.filter((r: any) => r.kind === "shareholders") as { speaks_for: string; visible_to: string[]; data: { holders: { holder: string; account: string; shares: number }[] } }[];
    const households = config.world.records.filter((r: any) => r.kind === "household") as { data: { leaseholder: string } }[];
    const heads = new Set(households.map((h) => h.data.leaseholder));
    const firms = config.world.entities.filter((e: any) => ["factory", "shop", "landlord"].includes(e.kind));
    expect(registers.length).toBe(firms.length);
    const accounts = new Set(config.world.accounts.map((a: any) => a.id));
    const kindOf = new Map<string, "factory" | "shop" | "landlord">(firms.map((e: any) => [e.id, e.kind]));
    const held = { closely: 0, outside: 0, widely: 0 };
    const owners = new Map<string, number>();
    for (const r of registers) {
      const holders = r.data.holders;
      // Every share of the firm is someone's (but what dividing among equal owners leaves), each holder has an
      // account to be paid into, and sees the register.
      expect(holders.reduce((x, h) => x + h.shares, 0)).toBeGreaterThan(999_990);
      expect(holders.reduce((x, h) => x + h.shares, 0)).toBeLessThanOrEqual(1_000_000);
      expect(new Set(holders.map((h) => h.holder)).size).toBe(holders.length);
      for (const h of holders) {
        expect(h.shares).toBeGreaterThan(0);
        expect(accounts.has(h.account)).toBe(true);
        expect(r.visible_to).toContain(h.holder);
      }
      const people = holders.filter((h) => heads.has(h.holder));
      const outside = holders.find((h) => h.holder === "outside")?.shares ?? 0;
      const fund = holders.find((h) => h.holder === "fund")?.shares ?? 0;
      if (!withFund) expect(fund).toBe(0);
      expect(people.length + (outside ? 1 : 0) + (fund ? 1 : 0)).toBe(holders.length);
      const forms = profile.forms_bps[kindOf.get(r.speaks_for)!];
      if (outside === 1_000_000) {
        // (All from outside: a firm of a kind held that way, or, with no fund, a widely held one that no household
        // happens to hold directly.)
        held.outside++;
        expect(forms.outside + (withFund ? 0 : forms.widely_held)).toBeGreaterThan(0);
      } else if (fund || outside) {
        // Widely held: the profile's part from outside, and the rest the town's.
        held.widely++;
        expect(forms.widely_held).toBeGreaterThan(0);
        const fromOutside = (1_000_000 * profile.widely_held.outside_bps) / 10_000;
        const local = 1_000_000 - fromOutside;
        expect(people.length).toBeGreaterThan(0);
        if (withFund) {
          // The fund has its share of the town's part (and what rounding leaves); direct holders the remainder.
          expect(outside).toBe(fromOutside);
          const fundsShare = Math.floor((local * values.retirement_fund.share_bps_of_local) / 10_000);
          expect(fund).toBeGreaterThanOrEqual(fundsShare);
          expect(fund).toBeLessThanOrEqual(fundsShare + people.length);
        } else {
          // No fund: the households that hold it directly have the town's whole part (what rounding leaves, a share
          // or so a holder, goes with the part from outside: nothing is paid to nobody).
          const direct = people.reduce((x, h) => x + h.shares, 0);
          expect(direct).toBeLessThanOrEqual(local);
          expect(direct).toBeGreaterThan(local - people.length - 1);
          expect(outside).toBe(1_000_000 - direct);
        }
      } else {
        // Closely held: one household or a few, in equal parts.
        held.closely++;
        expect(forms.closely_held).toBeGreaterThan(0);
        expect(people.length).toBeGreaterThanOrEqual(1);
        expect(people.length).toBeLessThanOrEqual(profile.closely_held.households_bps.length);
        expect(new Set(people.map((h) => h.shares)).size).toBe(1);
        for (const h of people) owners.set(h.holder, (owners.get(h.holder) ?? 0) + 1);
      }
    }
    // Of each kind, the profile's share of firms is held from outside.
    for (const kind of ["factory", "shop", "landlord"] as const) {
      const of = registers.filter((r) => kindOf.get(r.speaks_for) === kind);
      expect(of.filter((r) => r.data.holders.length === 1 && r.data.holders[0]!.holder === "outside").length).toBe(Math.round((of.length * profile.forms_bps[kind].outside) / 10_000));
    }
    expect(held.closely).toBeGreaterThan(0);
    expect(held.widely).toBeGreaterThan(0);
    // No household owns a second business while there are households that could own one and have none.
    expect(Math.max(...owners.values())).toBe(1);
    // The register lines grow with the town, not with the town times its firms: no household is on every register,
    // and most households are on none.
    const lines = registers.reduce((x, r) => x + r.data.holders.length, 0);
    expect(lines).toBeLessThan(households.length * profile.direct_holders.firms_held[1] + 3 * firms.length);
    const on = new Map<string, number>();
    for (const r of registers) for (const h of r.data.holders) if (heads.has(h.holder)) on.set(h.holder, (on.get(h.holder) ?? 0) + 1);
    expect(Math.max(...on.values())).toBeLessThanOrEqual(profile.direct_holders.firms_held[1] + 1);
    expect(on.size).toBeLessThan(households.length * 0.6);
    if (!withFund) continue;
    // The fund: an organisation of the town with an account, an office that runs it, and a register only it sees of
    // its members: adults of the town (the profile's share of them, give or take the draw), each with units.
    const members = config.world.records.find((r: any) => r.kind === "fund_members");
    expect(members.visible_to).toEqual(["fund"]);
    const adults = new Set(config.world.entities.filter((e: any) => e.kind === "person" && -e.born_at >= 18 * 365 * 86_400).map((e: any) => e.id));
    for (const m of members.data.members) {
      expect(adults.has(m.member)).toBe(true);
      expect(m.units).toBeGreaterThan(0);
      expect(accounts.has(m.account)).toBe(true);
    }
    expect(Math.abs(members.data.members.length / adults.size - values.retirement_fund.member_bps / 10_000)).toBeLessThan(0.08);
    expect(config.positions.find((p: any) => p.entity === "fund").role_module.code).toBe("fund.retirement");
  }
});

// Stopping work (docs/behaviour/citizen.md): at the profile's one age, or, where the profile gives the share in the
// labour force by age, at each person's own.
test("people stop work at one age where the profile gives no curve, and at ages of their own, drawn to the curve's shares, where it does", async () => {
  const { generateFrom } = await import("../generator/generate");
  const { loadProfile } = await import("../generator/profile");
  const big = Bun.YAML.parse(readFileSync(join(root, "worlds/town-1000.yaml"), "utf8")) as TownSpec;
  const YEAR = 365 * 86_400;
  const look = (P: any) => {
    const c = generateFrom(big, P);
    const age = new Map<string, number>(c.world.entities.filter((e: any) => e.kind === "person").map((e: any) => [e.id, Math.floor(-e.born_at / YEAR)]));
    const params = new Map<string, any>(c.participants.filter((p: any) => p.kind === "person").map((p: any) => [p.person, p.controller.params]));
    const workers = new Set<string>(c.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment").map((r: any) => r.terms.parties[1]));
    return { c, age, params, workers };
  };
  // One age: nobody is given an age of their own, and nobody at or over the age has a job.
  const single = structuredClone(loadProfile("au-vic-2026"));
  delete single.values.labour_force_share_by_age;
  const one = look(single);
  expect([...one.params.values()].some((p) => p.stops_work_at !== undefined || p.stop_work_curve !== undefined)).toBe(false);
  expect([...one.workers].filter((w) => one.age.get(w)! >= single.values.retirement_age)).toEqual([]);
  // A curve (not any place's): four fifths in the labour force at 25 to 54, three fifths of those still in at 55, a
  // quarter at 65, none from 75.
  const P = structuredClone(single);
  P.values.labour_force_share_by_age = [{ from: 25, bps: 8000 }, { from: 55, bps: 4800 }, { from: 65, bps: 2000 }, { from: 75, bps: 0 }];
  const many = look(P);
  const adults = [...many.age].filter(([, a]) => a >= 18).map(([id]) => id);
  const inForce = adults.filter((id) => many.params.get(id).in_labour_force !== false);
  expect(Math.abs(inForce.length / adults.length - P.values.labour_force_participation_bps / 10_000)).toBeLessThan(0.04);
  // Everyone in the labour force has their own age (this curve leaves nobody who never stops); the shares stopping at
  // each band are the curve's.
  const stops = inForce.map((id) => many.params.get(id).stops_work_at);
  expect(stops.every((s) => [55, 65, 75].includes(s))).toBe(true);
  const share = (at: number) => stops.filter((s) => s === at).length / stops.length;
  expect(Math.abs(share(55) - 0.4)).toBeLessThan(0.05);
  expect(Math.abs(share(65) - 0.35)).toBeLessThan(0.05);
  expect(Math.abs(share(75) - 0.25)).toBeLessThan(0.05);
  // Nobody past their own age holds a job; some past the profile's retirement age do, and some under it have stopped.
  expect([...many.workers].filter((w) => many.age.get(w)! >= many.params.get(w).stops_work_at)).toEqual([]);
  expect([...many.workers].filter((w) => many.age.get(w)! >= P.values.retirement_age).length).toBeGreaterThan(0);
  expect(inForce.filter((id) => many.age.get(id)! < P.values.retirement_age && many.age.get(id)! >= many.params.get(id).stops_work_at).length).toBeGreaterThan(0);
  // Those who come later draw their own from the same curve.
  expect(many.c.templates.filter((t: any) => t.kind === "person").every((t: any) => JSON.stringify(t.controller.params.stop_work_curve) === JSON.stringify(P.values.labour_force_share_by_age))).toBe(true);
}, 120_000);
