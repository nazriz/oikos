// Everything physical is somewhere, and moves only along a network (law 9: docs/design/foundations-2.md section 3; Naz,
// 2026-10-25: realism gaps made impossible at the kernel and platform layer, "eliminating the possibility of whack-a-moles").
// Every body, holding, vehicle and machine has a location: a space of a structure, a node of a network or a link it is
// travelling; moving is along links, each with a length and a capacity, and takes time, capacity and the mover's energy.
// The kernel's side is `kernel/tests/space.rs`.
//
// These tests are the backstop behind that, and should never fire: they read the generated town of every profile and the
// sources of the modules, and fail naming the body, the edge, the cover or the module (a month of each town's log is read by
// everything-is-somewhere-runs.test.ts, in the slow tier). Today's violations are in the inventory
// (`fixtures/space-inventory.json`), which only shrinks: a finding not in it fails, and an entry no longer found fails too,
// so that the change that ends a case removes its entry. The second half plants one of each.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { casesStanding, inventory, root, specialCasesLeft } from "./lib/law8";
import { CONFIG_AUDITS, edgesWithoutNode, farActs, SPACE_INVENTORY, uncarried, unlocated, waysOffNetwork } from "./lib/law9";

const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
/** A living town of a profile, small: every kind of office, venue and firm. */
const town = (profile: string) => generate({ ...spec, citizens: 120, profile, factories: 3, living: spec.living ?? {} });
/** The audits this file reads (a run's are the slow tier's). */
const HERE = [...Object.keys(CONFIG_AUDITS), "uncarried"];

// ----------------------------------------------------------------------------------------------------------------- it passes on every profile

test("every profile's town has nothing nowhere, no edge off the network and no way that is no link beyond the inventory, and no module moves goods with no carrier beyond it", () => {
  const inv = inventory(SPACE_INVENTORY);
  const seen: Record<string, Set<string>> = Object.fromEntries(HERE.map((k) => [k, new Set<string>()]));
  for (const profile of profiles) {
    const c = town(profile);
    for (const [name, audit] of Object.entries(CONFIG_AUDITS)) {
      const found = audit(c);
      for (const f of found) seen[name]!.add(f);
      // (A finding the inventory does not list is a new way round the law: report it, never add it to pass.)
      expect(found.filter((f) => !(inv.found[name] ?? []).includes(f)), `${profile}: ${name} not in the inventory`).toEqual([]);
    }
  }
  for (const f of uncarried()) seen.uncarried!.add(f);
  expect([...seen.uncarried!].filter((f) => !(inv.found.uncarried ?? []).includes(f)), "uncarried not in the inventory").toEqual([]);
  // The inventory only shrinks: an entry no longer found anywhere is removed by the change that ended it.
  for (const name of HERE) expect((inv.found[name] ?? []).filter((f) => !seen[name]?.has(f)), `${name}: listed in the inventory and no longer found (remove it)`).toEqual([]);
  const standing = new Set(casesStanding(inv));
  expect(inv.entries.filter((e) => !inv.done.includes(e.step) && !standing.has(e.id)).map((e) => e.id), "special cases listed as standing and no longer found (move their step to done, or remove them)").toEqual([]);
}, 120_000);

test("the special cases the landed steps deleted are gone, and stay gone", () => {
  expect(specialCasesLeft(SPACE_INVENTORY), "special cases law 9's steps deleted, standing again").toEqual([]);
});

test("the kernel's side exists: bodies in one place at a time, and trips that take their time", () => {
  expect(existsSync(join(root, "kernel/tests/space.rs"))).toBe(true);
});

// ----------------------------------------------------------------------------------------------------------------- it fails on what it is for

test("it fails, naming what is nowhere: a body in no space, a holding at no place, a system with no place", () => {
  const c = structuredClone(town("au-vic-2026"));
  c.world.occupancy = [];
  c.world.holdings.push({ kind: "goods", holder: "builder", at: "nowhere-yard", quantity: "1" });
  c.participants = c.participants.map((p: any) => (p.kind === "system" ? { ...p, at: c.world.structures[0].id } : p));
  c.participants.push({ id: "planted-system", kind: "system", template: "planted-template", owner: "outside", supplier: "outside" });
  expect(unlocated(c)).toEqual(["bodies in no space at the start, so nowhere (the unhoused)", "goods held at nowhere-yard, which is no structure or edge", "planted-template: a system with no place (the hardware it runs on held nowhere)"]);
});

test("it fails, naming the edge, on an edge that is no node of a world's network, and is quiet on one that is", () => {
  const c = structuredClone(town("au-vic-2026"));
  c.world.boundaries = ["outside", "far-market"];
  c.world.network.nodes.push({ id: "n-edge-outside", edge: "outside" });
  expect(edgesWithoutNode(c)).toEqual(["far-market: an edge with no node, so what it sells and takes arrives nowhere"]);
});

test("it fails, naming the cover, on ground crossed quicker than on foot", () => {
  const c = structuredClone(town("au-vic-2026"));
  c.catalogue.travel = { seconds_per_cell: 18, by_cover: { water: 120, motorway: 1 } };
  expect(waysOffNetwork(c)).toEqual(["motorway: ground crossed quicker than on foot, a way that is no link of the network"]);
});

test("it fails, naming the file, on a module that moves goods with no carrier, and is quiet on one that names it", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-somewhere-"));
  try {
    const src = join(dir, "kernel/crates/actors/src/market");
    Bun.spawnSync(["mkdir", "-p", src]);
    writeFileSync(join(src, "van.rs"), 'fn ship() {\n    call("goods", vec![("kind", k), ("to", t), ("at", a), ("from_at", f), ("carrier", v)]);\n}\n');
    writeFileSync(join(src, "teleport.rs"), 'fn ship() {\n    // call("goods") in a comment is not a move\n    call("goods", vec![("kind", k), ("to", t), ("at", a), ("from_at", f)]);\n}\n#[cfg(test)]\nmod tests { fn t() { call("goods", vec![]); } }\n');
    expect(uncarried(["kernel/crates/actors/src"], dir)).toEqual(["kernel/crates/actors/src/market/teleport.rs: goods moved with no carrier"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("it fails, naming the module, on goods moved between places with no carrier and work on a building elsewhere, read from a log", () => {
  const c = { positions: [{ id: "crew-post", role_module: { code: "city.works" } }], participants: [{ id: "c1-self", controller: { type: "code", impl: "citizen.default" } }], world: { structures: [{ id: "depot" }, { id: "house-1" }] } };
  const ev = (body: object) => JSON.stringify({ kind: "event", body });
  const lines = [
    ev({ event: "action_applied", as: "crew-post", participant: "c1-self" }),
    ev({ event: "worked", task: "collect", at: "depot", on: "house-1", by: "c1-self" }),
    ev({ event: "worked", task: "serve", at: "depot", on: "depot/workplace.1", by: "c1-self" }),
    ev({ event: "action_applied", participant: "c1-self" }),
    ev({ event: "goods_moved", from_at: "shop", to_at: "house-1", by: "c1-self" }),
    ev({ event: "goods_moved", from_at: "shop", to_at: "shop", by: "c1-self" }),
    ev({ event: "goods_moved", from_at: "shop", to_at: "house-1", by: "c1-self", carrier: "c1" }),
  ];
  expect(farActs(lines, c)).toEqual({ uncarriedMoves: ["citizen.default: goods moved from one place to another with no carrier"], workElsewhere: ["city.works: collect done on a building elsewhere, its crew where they were"] });
});

test("it fails, naming the entry, on a special case a landed step deleted that stands again", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-somewhere-inv-"));
  try {
    const path = join(dir, "inventory.json");
    writeFileSync(path, JSON.stringify({ done: ["S9"], found: {}, entries: [{ id: "planted", step: "S9", kind: "delete", file: "kernel/crates/world/src/travel.rs", find: "pub fn seconds(", what: "a planted case" }] }));
    expect(specialCasesLeft(path).map((x) => x.replace(/:\d+$/, ""))).toEqual(["planted (S9): kernel/crates/world/src/travel.rs"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
