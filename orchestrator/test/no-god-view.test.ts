// Nobody has a god's view (docs/no-god-view.md; docs/design/knowing.md; Naz, 2026-10-08: "no entity should have a god
// like view of anything"). Information lives with whoever keeps it, and reaches a seat in four ways; the contract
// lets a channel say nothing else, and the kernel refuses a world that gives a register to a seat that does not keep
// it (kernel/tests/knowing.rs; contracts/examples/invalid and refused). These tests are the backstop behind that, and
// should never fire: they read the generated town and fail the build when a whole view appears that is not a keeper's
// (`keeps`) or a boundary module's (`boundary`), and they list every declaration in one place, so that adding one is
// a change someone reads.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modules } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { PUBLISHED } from "@oikos/worlds/generator/knowing";
import { wholeViews, type WholeView } from "../src/views";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

/** The generated town, with enough of each kind of firm to be a population, as a code town and with every office a
 * model's (a model seat is given channels a code seat isn't), and with a scripted shock (a scenario's future). */
function towns(): any[] {
  const base = { ...spec, factories: 5, shocks: [{ from_day: 30, kind: "goods", what: "price", factor_bps: 12_000 }] };
  const code = generate(base);
  return [code, generate({ ...base, mayor: "llm", model_seats: code.positions.map((p: any) => p.id) })];
}

/** Every whole view in the generated towns, once each. */
function found(): WholeView[] {
  const all = new Map<string, WholeView>();
  for (const town of towns()) for (const v of wholeViews(town)) all.set(`${v.module}: ${v.what}`, all.get(`${v.module}: ${v.what}`) ?? v);
  return [...all.values()];
}

const line = (module: string, what: string) => `${module}: ${what}`;
const said = (field: "keeps" | "boundary") => Object.values(modules).flatMap((m) => (m[field] ?? []).map((k) => line(m.name, k.what))).sort();

/**
 * Every keeper: a kind of participant that holds a whole register because it is the office that keeps it. The reason
 * for each is beside the module (its `keeps`, and in its manifest). To add one, declare it there and add it here; a
 * register someone else keeps is never declared: it is asked for (`ask`, participants/src/behaviour/common.ts).
 */
const KEEPERS = [
  "bank.lending: request",
  "bank.payment_system: request",
  "city.electoral_office: electoral_roll",
  "city.electoral_office: enrolment",
  "city.rates_officer: valuation",
  "city.registry: lot",
  "city.registry: records:claim",
  "city.registry: records:claim_release",
  "city.registry: records:claim_transfer",
  "city.registry: records:withdrawal",
  "school.principal: school_enrolment",
  "school.principal: school_place",
];

/** Every boundary module: one that stands for the simulation's own edge and is handed its conditions. */
const BOUNDARY = [
  "world.trade: every:factory",
  "world.trade: future",
  "world.weather: future",
];

/**
 * Whole views still to be removed (docs/decisions.md, "Nobody has a god's view"): each was found by this test, none is
 * a keeper's, and none may be added to. The list only shrinks: a view here that is no longer found fails the test
 * until its line is taken out.
 */
const OWED: string[] = [
  "bank.lending: directory",
  "bank.payment_system: directory",
  "city.child_protection: directory",
  "city.council_clerk: directory",
  "city.councillor: directory",
  "city.electoral_office: directory",
  "city.environment: directory",
  "city.environment: enrolment",
  "city.environment: lot",
  "city.environment: map",
  "city.environment: records:claim",
  "city.finance_officer: directory",
  "city.finance_officer: enrolment",
  "city.finance_officer: lot",
  "city.finance_officer: records:claim",
  "city.inspector: directory",
  "city.inspector: lot",
  "city.inspector: map",
  "city.inspector: records:claim",
  "city.inspector: records:claim_release",
  "city.inspector: records:claim_transfer",
  "city.inspector: records:withdrawal",
  "city.mayor_code: directory",
  "city.mayor_code: enrolment",
  "city.mayor_code: lot",
  "city.mayor_code: map",
  "city.mayor_code: records:claim",
  "city.planning_officer: directory",
  "city.planning_officer: lot",
  "city.planning_officer: map",
  "city.planning_officer: records:claim",
  "city.planning_officer: records:claim_release",
  "city.planning_officer: records:claim_transfer",
  "city.planning_officer: records:withdrawal",
  "city.rates_officer: directory",
  "city.rates_officer: enrolment",
  "city.rates_officer: lot",
  "city.rates_officer: records:claim",
  "city.registry: directory",
  "city.works: directory",
  "city.works: enrolment",
  "city.works: lot",
  "city.works: map",
  "city.works: records:claim",
  "clinic.practice: directory",
  "firm.builder: directory",
  "firm.builder: map",
  "firm.landlord: directory",
  "firm.newspaper: directory",
  "firm.producer: directory",
  "firm.retailer: directory",
  "police.station: directory",
  "police.station: map",
  "school.principal: directory",
  "tribunal.member: directory",
  "tribunal.registrar: directory",
  "union.organiser: directory",
  "utility.energy: directory",
  "utility.water: directory",
  "utility.water: lot",
  "utility.water: map",
  "utility.water: records:claim",
  "utility.water: records:claim_release",
  "utility.water: records:claim_transfer",
  "utility.water: records:withdrawal",
  "world.disposal: directory",
  "world.funding: directory",
  "world.grants: directory",
  "world.grants: map",
  "world.migration: directory",
  "world.statistics: directory",
  "world.trade: directory",
  "world.transfers: directory",
  "world.valuer: directory",
  "world.valuer: lot",
  "world.valuer: map",
  "world.valuer: records:claim",
  "world.valuer: records:claim_release",
  "world.valuer: records:claim_transfer",
  "world.valuer: records:withdrawal",
  "world.weather: directory",
];

test("every keeper and every boundary module is listed here, and each says why", () => {
  expect(said("keeps")).toEqual(KEEPERS);
  expect(said("boundary")).toEqual(BOUNDARY);
  for (const m of Object.values(modules)) for (const k of [...(m.keeps ?? []), ...(m.boundary ?? [])]) expect(k.why.length).toBeGreaterThan(40);
  for (const p of PUBLISHED) expect(p.why.length).toBeGreaterThan(10);
  // What the world's config says of its keepers is what the modules say (the generator copies it; the kernel checks
  // every channel against it): each keeper there is declared by a module here, with its reason.
  for (const town of towns()) {
    for (const k of town.knowing.keepers as { entity: string; what: string; why: string }[]) {
      const seats = town.positions.filter((p: any) => p.entity === k.entity).map((p: any) => p.role_module?.code);
      expect(Object.values(modules).some((m) => seats.includes(m.name) && (m.keeps ?? []).some((x) => x.what === k.what && x.why === k.why))).toBe(true);
    }
  }
});

test("no kind of participant is shown a whole register, population or map, or the run's future, unless it keeps it and says so", () => {
  const allowed = new Set([...KEEPERS, ...BOUNDARY]);
  const undeclared = found().filter((v) => !allowed.has(line(v.module, v.what)))
    .map((v) => `${line(v.module, v.what)} (${v.through}, at ${v.seat}${v.seats > 1 ? ` and ${v.seats - 1} more` : ""})`).sort();
  const owed = new Set(OWED);
  // Nothing new: every whole view is a keeper's, a boundary module's, a publication, or one already owed.
  expect(undeclared.filter((u) => !owed.has(u.replace(/ \(.*$/, "")))).toEqual([]);
  // And what is owed is still there (take a line out of OWED when its view is gone).
  const still = new Set(undeclared.map((u) => u.replace(/ \(.*$/, "")));
  expect(OWED.filter((o) => !still.has(o))).toEqual([]);
});

test("a declaration nobody needs is not kept: each keeper and boundary module is shown what it says", () => {
  const seen = new Set(found().map((v) => line(v.module, v.what)));
  expect([...KEEPERS, ...BOUNDARY].filter((k) => !seen.has(k))).toEqual([]);
});

test("the backstop catches what it is for", () => {
  const town = generate(spec);
  const person = town.participants.find((p: any) => p.kind === "person");
  const views = (channels: any[], params: any = {}) => wholeViews({ ...town, positions: [], templates: [], participants: [{ ...person, channels, controller: { type: "code", impl: "x.y", params } }] }).map((v) => `${v.through} ${v.what}`);
  // A register kept is a whole view (its keeper's, to be declared); so is a list of every shop, and the run's future.
  expect(views([{ id: "titles", kind: "records", way: "kept", match: { records: ["claim"] } }])).toEqual(["channel:titles records:claim"]);
  expect(views([], { shops: town.world.entities.filter((e: any) => e.kind === "shop").map((e: any) => e.id) })).toEqual(["param:shops every:shop"]);
  expect(views([], { storms: [{ from_day: 40, days: 3 }] })).toEqual(["param:storms future"]);
  // Its own money, things and papers, what is near it, what is published, what it has to ask for, look up or go to: not.
  expect(views([{ id: "money", kind: "accounts" }, { id: "things", kind: "holdings" }, { id: "mine", kind: "records", way: "mine", match: {} }, { id: "street", kind: "sites", way: "here", area: { near: 0 } },
    { id: "laws", kind: "records", way: "published", match: { statement_kinds: ["law"] } }, { id: "jobs", kind: "records", way: "published", match: { statement_kinds: ["job_posting"] }, on_request: true },
    { id: "titles", kind: "records", way: "ask", of: "city", by: ["id"], match: { records: ["claim"] }, on_request: true }, { id: "who", kind: "directory", way: "ask" }, { id: "elsewhere", kind: "sites", way: "visit" }],
    { bank: "bank", storms: [] })).toEqual([]);
  // Its own files are a whole view when they hold a whole collection (everything a registry issues names the registry),
  // and premises that are most of the ground are a map.
  const office = (entity: string, channels: any[]) => wholeViews({ ...town, participants: [], templates: [], positions: [{ id: "desk", entity, channels, role_module: { code: "x.y" } }] }).map((v) => v.what);
  const issuer = town.world.records.find((r: any) => r.kind === "lot").speaks_for;
  expect(office(issuer, [{ id: "mine", kind: "records", way: "mine", match: {} }])).toContain("lot");
  const ground = Array.from({ length: town.world.ground.w * town.world.ground.h }, (_, i) => `cell.${i % town.world.ground.w}.${Math.floor(i / town.world.ground.w)}`);
  expect(office("city", [{ id: "estate", kind: "sites", way: "here", area: { premises: ground.slice(0, Math.ceil(ground.length / 2)) } }])).toEqual(["map"]);
});
