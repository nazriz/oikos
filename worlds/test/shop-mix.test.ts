// A town's mix of shops (docs/behaviour/demand.md, "A town's mix of shops"; docs/behaviour/generator.md).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, generateFrom, type TownSpec } from "../generator/generate";
import { loadProfile } from "../generator/profile";
import { apportion } from "../generator/shopmix";
import { officesBy } from "../../orchestrator/test/lib/offices";

const root = join(import.meta.dir, "../..");
const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec), citizens: 120, shops: 10 };

const shopsOf = (c: any) => officesBy(c, "firm.retailer").filter((o) => o.entity.startsWith("shop-"));
const kindsOf = (c: any) => {
  const n: Record<string, number> = {};
  for (const o of shopsOf(c)) n[o.params.kind] = (n[o.params.kind] ?? 0) + 1;
  return n;
};

test("with shop_mix a town's shops are divided among the profile's kinds by their shares of spending, each selling its kind", () => {
  for (const profile of ["au-vic-2026", "gb-eng-2026", "ke-nakuru-2026"]) {
    const c = generate({ ...spec, profile, shop_mix: true });
    const table = loadProfile(profile).values.spending.demand!.kinds.filter((k) => k.kind === "goods" || k.seller);
    const want = apportion(table.map((k) => k.share_bps), 10);
    const got = kindsOf(c);
    expect(Object.keys(got).length).toBeGreaterThanOrEqual(4);
    for (const [i, k] of table.entries()) expect(got[k.kind] ?? 0).toBe(want[i]!);
    // Each shop's opening stock is its kind, in the town's shop; the world market sells each kind wholesale, below the shop's price.
    const stock = c.world.holdings as { kind: string; holder: string }[];
    // Each kind of shop buys from a wholesaler of its own (an entity of the outside world, `wholesale-<kind>`), the world market for goods.
    const sells = Object.assign({}, ...officesBy(c, "world.trade").map((o) => o.params.sells)) as Record<string, number>;
    const sellers = new Map(officesBy(c, "world.trade").flatMap((o) => Object.keys(o.params.sells).map((k) => [k, o.entity] as const)));
    for (const o of shopsOf(c)) {
      expect(stock.find((h) => h.holder === o.entity)!.kind).toBe(o.params.kind);
      expect(sells[o.params.kind]).toBeGreaterThan(0);
      expect(sells[o.params.kind]).toBeLessThan(o.params.price);
      expect(o.params.demand).toBeGreaterThan(0);
      expect(o.params.suppliers).toEqual([sellers.get(o.params.kind)]);
      expect(sellers.get(o.params.kind)).toBe(o.params.kind === "goods" ? "outside" : `wholesale-${o.params.kind}`);
    }
    // Each kind's staff are what the place calls them, paid what its earnings survey says, and serve by a task of their own.
    for (const o of shopsOf(c)) {
      const k = table.find((x) => x.kind === o.params.kind)!;
      expect(o.params.serve_task ?? "serve").toBe(o.params.kind === "goods" ? "serve" : `serve-${o.params.kind}`);
      if (k.seller?.occupation && o.params.kind !== "goods") expect(o.params.role).toBe(k.seller.occupation);
    }
    expect(new Set(shopsOf(c).map((o) => o.params.wage)).size).toBeGreaterThan(1);
    // The work table has a task to use up each kind, and the resources name it.
    const json = JSON.stringify(c);
    for (const k of Object.keys(got)) {
      expect(json.includes(`"id":"consume-${k}"`) || k === "goods").toBe(true);
      expect(json.includes(`"id":"${k}","unit"`)).toBe(true);
    }
    // The citizens' demand names the kinds the town sells, and the opening price of each.
    const citizen = c.participants.find((p: any) => p.controller?.impl === "citizen.default");
    const d = citizen.controller.params.demand;
    expect(d.kinds.map((k: any) => k.kind).sort()).toEqual(Object.keys(got).sort());
    for (const o of shopsOf(c)) expect(d.reference_prices[o.params.kind]).toBe(o.params.price);
    // (A kind's unit is what the same staff time serves, so a larger labour share is a smaller unit.)
    const serve = new Set(shopsOf(c).map((o) => o.params.serve_labour));
    expect(serve.size).toBe(1);
  }
}, 60_000);

function officeParams(c: any, impl: string) {
  return officesBy(c, impl)[0]!.params;
}

test("a town with shop_mix: false has one kind of shop, selling goods, and the citizens weigh only goods; the mix is the default", () => {
  const off = generate({ ...spec, shop_mix: false });
  expect(JSON.stringify(generate(spec))).toBe(JSON.stringify(generate({ ...spec, shop_mix: true })));
  expect(Object.keys(kindsOf(generate(spec))).length).toBeGreaterThanOrEqual(4);
  for (const o of shopsOf(off)) expect(o.params.kind).toBeUndefined();
  const citizen = off.participants.find((p: any) => p.controller?.impl === "citizen.default");
  // (A town of one kind carries no demand figures: the citizen weighs goods alone without them, as the TS world's manifest
  // knows no such parameter. Written only for a town with the shop mix since integration, 2026-10-18, commit 26fb35a9.)
  expect(citizen.controller.params.demand).toBeUndefined();
  expect(Object.keys(officeParams(off, "world.trade").sells).sort()).toEqual(["energy", "goods", "inputs", "materials"].filter((k) => k in officeParams(off, "world.trade").sells));
  // Turning it on changes the shops and nothing of the households' count.
  const on = generate(spec);
  const people = (c: any) => c.participants.filter((p: any) => p.kind === "person").length;
  expect(people(on)).toBe(people(off));
});

test("a profile without the table keeps the single goods town, flag or no flag", () => {
  const P = structuredClone(loadProfile("au-vic-2026"));
  P.values.spending.demand!.kinds = P.values.spending.demand!.kinds.filter((k) => k.kind === "goods" || k.kind === "energy").map(({ seller, ...k }) => k);
  const a = generateFrom({ ...spec, shop_mix: true }, P);
  expect(Object.keys(kindsOf(a))).toEqual(["undefined"]);
  expect(JSON.stringify(a)).toBe(JSON.stringify(generateFrom(spec, P)));
});

test("business counts, where the profile gives them, divide the shops instead of spending", () => {
  const P = structuredClone(loadProfile("au-vic-2026"));
  const kinds = P.values.spending.demand!.kinds.filter((k) => k.kind === "goods" || k.seller);
  kinds.forEach((k, i) => { (k.seller ??= {}).business_share_bps = i === 0 ? 5000 : Math.floor(5000 / (kinds.length - 1)); });
  const got = kindsOf(generateFrom({ ...spec, shop_mix: true }, P));
  expect(got.goods).toBe(5);
  expect(Object.values(got).reduce((a, b) => a + b, 0)).toBe(10);
});

test("shops are apportioned by largest remainder, to the whole number of shops, and goods keeps one", () => {
  expect(apportion([5000, 3000, 2000], 10)).toEqual([5, 3, 2]);
  expect(apportion([1, 1, 1], 4)).toEqual([2, 1, 1]);
  expect(apportion([1, 0, 1], 3)).toEqual([2, 0, 1]);
  expect(apportion([1, 1], 0)).toEqual([0, 0]);
  const c = generate({ ...spec, shops: 2, shop_mix: true });
  expect(kindsOf(c).goods).toBeGreaterThanOrEqual(1);
});

test("each kind of shop has premises of its own type with room for its staff, and a venture to found one (not six staff and one template for all)", () => {
  const c = generate(spec) as any;
  const types = new Map<string, any>(c.catalogue.structure_types.map((t: any) => [t.id, t]));
  const roomOf = (id: string) => types.get(id).spaces.find((s: any) => s.kind === "workplace").capacity as number;
  const ventures = citizenParams(c).ventures as { kind: string; role_module: { params: { kind?: string; max_staff: number; price: number } } }[];
  const kinds = new Set<string>();
  for (const o of shopsOf(c)) {
    const premises = structureOf(c, o.params.premises);
    expect(premises.type === "shop" ? o.params.kind === "goods" : premises.type === `shop-${o.params.kind}`).toBe(true);
    expect(roomOf(premises.type)).toBeGreaterThanOrEqual(o.params.max_staff);
    kinds.add(premises.type);
  }
  expect(kinds.size).toBeGreaterThanOrEqual(4);
  // a venture for each type of premises a shop stands in, carrying that kind's price and room
  expect(new Set(ventures.filter((v) => v.kind.startsWith("shop")).map((v) => v.kind))).toEqual(kinds);
  for (const v of ventures.filter((x) => x.kind.startsWith("shop"))) {
    expect(v.role_module.params.max_staff).toBe(roomOf(v.kind));
    expect(v.role_module.params.price).toBeGreaterThan(0);
  }
  expect(new Set(ventures.filter((v) => v.kind.startsWith("shop")).map((v) => v.role_module.params.price)).size).toBeGreaterThan(1);
});

test("each kind of seller is its own: wages and jobs by occupation, a wholesaler of its own, factories by product with their inputs, and complaints in the kinds' shares", () => {
  for (const profile of ["au-vic-2026", "gb-eng-2026", "ke-nakuru-2026"]) {
    const P = loadProfile(profile);
    const c = generate({ ...spec, profile, factories: 6, living: {} }) as any;
    // Wages by occupation: a shop of a kind is paid the kind's share of the shop wage, in the workplace and the shop's rule.
    const wage = new Map(shopsOf(c).map((o) => [o.params.kind, o.params.wage as number]));
    for (const k of P.values.spending.demand!.kinds.filter((x) => wage.has(x.kind)))
      expect(wage.get(k.kind)).toBe(Math.round((P.values.wages_per_pay_period.shop * (k.seller?.wage_vs_shop_bps ?? 10_000)) / 10_000));
    // A trader of the outside world for each kind besides goods; none of them sells another's kind, nor the world market the kind.
    const traders = officesBy(c, "world.trade");
    for (const t of traders.filter((x) => x.entity !== "outside")) expect(Object.keys(t.params.sells)).toEqual([t.entity.replace("wholesale-", "")]);
    expect(Object.keys(traders.find((x) => x.entity === "outside")!.params.sells).filter((k) => wage.has(k) && k !== "goods")).toEqual([]);
    // Factories by product: each makes the product of its works from its own input, which the world sells, and the world buys the product.
    const producers = officesBy(c, "firm.producer");
    const made = new Set(producers.map((o) => o.params.output ?? "goods"));
    expect(made.has("goods")).toBe(true);
    const world = traders.find((x) => x.entity === "outside")!.params;
    for (const o of producers) {
      const kind = o.params.output ?? "goods";
      expect(Object.keys(o.params.per_unit).length).toBe(1);
      const input = Object.keys(o.params.per_unit)[0]!;
      expect(world.sells[input]).toBeGreaterThan(0);
      expect(world.buys[kind]).toBeDefined();
      expect(JSON.stringify(c).includes(`"id":"${o.params.task ?? "make"}"`)).toBe(true);
    }
    // Complaints by kind: the town's rate is the profile's, shared among the kinds.
    const citizen = citizenParams(c);
    const f = citizen.frictions;
    const total = f.faulty_bps_per_year + Object.values(f.faulty_by_kind as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - P.values.frictions!.per_adult_bps_per_year.goods)).toBeLessThanOrEqual(Object.keys(f.faulty_by_kind).length);
  }
}, 60_000);

function citizenParams(c: any) {
  return c.participants.find((p: any) => p.controller?.impl === "citizen.default").controller.params;
}

/** The structure with this id, wherever the config keeps its structures. */
function structureOf(c: any, id: string): { id: string; type: string } {
  const seen: any[] = [c];
  while (seen.length) {
    const x = seen.pop();
    if (Array.isArray(x)) { for (const y of x) { if (y && y.id === id && typeof y.type === "string" && y.built_by !== undefined) return y; seen.push(y); } }
    else if (x && typeof x === "object") seen.push(...Object.values(x));
  }
  throw new Error(`no structure ${id}`);
}
