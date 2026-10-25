// Nothing physical from nothing (law 8: docs/nothing-from-nothing.md; docs/design/foundations-2.md section 2; Naz,
// 2026-10-25: realism gaps made impossible at the kernel and platform layer, "eliminating the possibility of
// whack-a-moles"). Every physical quantity is a declared kind, held somewhere, and changed only by its holder's move, a
// process with a recipe, nature's declared dynamics or a world edge; a building's variable is a condition, never a
// stock; who goes short follows from the network's physics, the supply contracts in force and the operators' own acts,
// never from a rule of the kernel's or a module's. The kernel's side is `kernel/tests/conservation.rs`.
//
// These tests are the backstop behind that, and should never fire: they read the generated town of every profile and
// the sources of the modules, and fail naming the kind, the variable, the recipe or the module. Today's violations are
// in the inventory (`fixtures/foundations-2-inventory.json`), which only shrinks: a finding not in it fails, and an entry
// no longer found fails too, so that the change that ends a case removes its entry. The second half plants one of each.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { AUDITS, allocationRules, billsWithoutMeters, casesStanding, inventory, orphanKinds, root, silentRecipes, SOURCES, specialCasesLeft, stocksAsVariables, type Task, vanishing } from "./lib/law8";

const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
/** A living town of a profile, small: every kind of office, venue and firm, with the everyday frictions on. */
const town = (profile: string) => generate({ ...spec, citizens: 120, profile, factories: 3, living: spec.living ?? {} });

// ----------------------------------------------------------------------------------------------------------------- it passes on every profile

test("every profile's town has no stock as a variable, orphan kind, silent recipe, bill without a meter or vanishing quantity beyond the inventory, and no module allocates a shortfall", () => {
  const inv = inventory();
  const seen: Record<string, Set<string>> = Object.fromEntries([...Object.keys(AUDITS), "allocationRules"].map((k) => [k, new Set<string>()]));
  for (const profile of profiles) {
    const c = town(profile);
    for (const [name, audit] of Object.entries(AUDITS)) {
      const found = audit(c);
      for (const f of found) seen[name]!.add(f);
      // (A finding the inventory does not list is a new way round the law: report it, never add it to pass.)
      expect(found.filter((f) => !(inv.found[name] ?? []).includes(f)), `${profile}: ${name} not in the inventory`).toEqual([]);
    }
  }
  for (const f of allocationRules(SOURCES)) seen.allocationRules!.add(f);
  expect([...seen.allocationRules!].filter((f) => !(inv.found.allocationRules ?? []).includes(f)), "allocationRules not in the inventory").toEqual([]);
  // The inventory only shrinks: an entry no longer found anywhere is removed by the change that ended it.
  for (const [name, listed] of Object.entries(inv.found)) expect(listed.filter((f) => !seen[name]?.has(f)), `${name}: listed in the inventory and no longer found (remove it)`).toEqual([]);
  const standing = new Set(casesStanding(inv));
  expect(inv.entries.filter((e) => !inv.done.includes(e.step) && !standing.has(e.id)).map((e) => e.id), "special cases listed as standing and no longer found (move their step to done, or remove them)").toEqual([]);
}, 120_000);

test("the special cases the landed steps deleted are gone, and stay gone", () => {
  expect(specialCasesLeft(), "special cases law 8's steps deleted, standing again").toEqual([]);
});

test("the kernel's side exists: conservation over holdings, fields and edges", () => {
  expect(existsSync(join(root, "kernel/tests/conservation.rs"))).toBe(true);
  expect(existsSync(join(root, "kernel/tests/goods.rs")), "goods.rs is generalised into conservation.rs").toBe(false);
});

// ----------------------------------------------------------------------------------------------------------------- it fails on what it is for

test("it fails, naming the variable, on a stock kept as a variable: one that grows by its occupants, one named as a kind, one read as a meter", () => {
  const c = structuredClone(town("au-vic-2026"));
  const before = stocksAsVariables(c);
  c.catalogue.variables.push({ id: "sewage", min: 0, max: 1_000_000, initial: 0, per_occupant_per_day: 120 });
  c.catalogue.variables.push({ id: "materials", min: 0, max: 1_000_000, initial: 0, per_day: 1 });
  c.catalogue.variables.push({ id: "gas_used", min: 0, max: 1_000_000, initial: 0, per_day: 1 });
  c.positions.find((p: any) => p.role_module?.params)!.role_module.params.meter = "gas_used";
  expect(stocksAsVariables(c).filter((x) => !before.includes(x))).toEqual(["gas_used: read as a meter by " + c.positions.find((p: any) => p.role_module?.params?.meter === "gas_used").role_module.code, "materials: a variable with the name of a kind the world holds", "sewage: grows by its occupants (per_occupant_per_day)"]);
});

test("it fails, naming the kind, on an orphan: a kind consumed that nothing makes, a kind made that nothing uses", () => {
  const c = structuredClone(town("au-vic-2026"));
  const before = orphanKinds(c);
  c.catalogue.resources.push({ id: "unobtainium", unit: "kg" }, { id: "slag", unit: "kg" });
  c.catalogue.tasks.push({ id: "alchemy", labour: 60, in: "workplace", consumes: { unobtainium: "1" }, produces: { goods: "1" } });
  c.catalogue.tasks.push({ id: "smelt", labour: 60, in: "workplace", consumes: { inputs: "1" }, produces: { slag: "1" } });
  expect(orphanKinds(c).filter((x) => !before.includes(x))).toEqual(["unobtainium: consumed, and nothing makes it (no recipe, edge or nature)", "slag: made, and nothing uses it or takes it in"]);
});

test("it fails, naming the recipe, on a recipe at a workplace that does not say its energy or water", () => {
  const c = structuredClone(town("au-vic-2026"));
  c.catalogue.tasks = c.catalogue.tasks.map((t: Task) => (t.in === "workplace" ? { ...t, consumes: { ...t.consumes, energy: "0", water: "0" } } : t));
  expect(silentRecipes(c).filter((x) => !x.includes("no such kind"))).toEqual([]);
  c.catalogue.tasks.push({ id: "weld", labour: 600, in: "workplace", consumes: { inputs: "2", water: "0" }, produces: { goods: "1" } });
  expect(silentRecipes(c).filter((x) => x.startsWith("weld"))).toEqual(["weld: states no energy"]);
});

test("it fails, naming the module, on a bill for an assumed use", () => {
  const c = structuredClone(town("au-vic-2026"));
  const before = billsWithoutMeters(c);
  const office = c.positions.find((p: any) => p.role_module?.code === "city.works")!;
  office.role_module.params.bins_per_household_per_month = 4;
  expect(billsWithoutMeters(c).filter((x) => !before.includes(x))).toEqual(["city.works: bins_per_household_per_month (an assumed use, not a meter or a holding)"]);
});

test("it fails, naming the recipe, on a quantity that vanishes: a draw into nothing, a process that only destroys a stock", () => {
  const c = structuredClone(town("au-vic-2026"));
  const before = vanishing(c);
  c.catalogue.fields.push({ id: "aquifer", min: 0, max: 1_000_000 });
  c.catalogue.tasks.push({ id: "pump", labour: 0, draws: { field: "aquifer", per_unit: 1 } });
  c.catalogue.tasks.push({ id: "burn", labour: 0, consumes: { materials: "1" } });
  // (A kind that dissipates may be used up with nothing out: energy leaves the books as heat.)
  c.catalogue.resources.push({ id: "heat_fuel", unit: "kWh", class: "dissipates" });
  c.catalogue.tasks.push({ id: "warm", labour: 0, consumes: { heat_fuel: "1" } });
  expect(vanishing(c).filter((x) => !before.includes(x))).toEqual(["pump: draws from aquifer, which holds no kind: what is drawn goes nowhere", "burn: only destroys materials (a stock kind: it must become something, or be a kind that dissipates)"]);
});

test("it fails, naming the file, on a module that shares out a shortfall by a rule of its own", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-nothing-"));
  try {
    const src = join(dir, "kernel/crates/actors/src/offices");
    Bun.spawnSync(["mkdir", "-p", src]);
    writeFileSync(join(src, "grid.rs"), "fn settle(asked: i64, have: i64) -> i64 {\n    // a comment about rationing is not a rule\n    let each = pro_rata(asked, have);\n    each\n}\n");
    expect(allocationRules(["kernel/crates/actors/src"], dir)).toEqual(["kernel/crates/actors/src/offices/grid.rs: pro_rata"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("it fails, naming the entry, on a special case a landed step deleted that stands again", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-nothing-inv-"));
  try {
    const path = join(dir, "inventory.json");
    writeFileSync(path, JSON.stringify({ done: ["C9"], found: {}, entries: [{ id: "planted", step: "C9", kind: "delete", file: "worlds/generator/generate.ts", find: "export const GENERATOR_VERSION", what: "a planted case" }] }));
    expect(specialCasesLeft(path).map((x) => x.replace(/:\d+$/, ""))).toEqual(["planted (C9): worlds/generator/generate.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
