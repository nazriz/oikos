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
import { culture, DayBook, modules } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { PUBLISHED } from "@oikos/worlds/generator/knowing";
import { wholeViews, type WholeView } from "../src/views";
import { rustManifests } from "./lib/rust-manifests";

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
 * register someone else keeps is never declared: it is asked for (`ask`, participants/src/shared/common.ts).
 */
const KEEPERS = [
  "bank.lending: accounts",
  "bank.lending: request",
  "bank.payment_system: accounts",
  "bank.payment_system: request",
  "city.electoral_office: electoral_roll",
  "city.electoral_office: enrolment",
  "city.rates_officer: valuation",
  "city.works: service_address",
  "land.registry: lot",
  "land.registry: records:claim",
  "land.registry: records:claim_release",
  "land.registry: records:claim_transfer",
  "land.registry: records:withdrawal",
  "school.principal: school_enrolment",
  "school.principal: school_place",
  "utility.energy: connections",
  "utility.water: acquisition_notice",
  "utility.water: connections",
  "utility.water: property_roll",
  // (2026-10-12: a town opens with the claims already in payment on the support office's file, docs/behaviour/generator.md.)
  "world.transfers: benefit_claim",
  "world.transfers: benefit_decision",
  "world.valuer: acquisition_notice",
  "world.valuer: property_roll",
];

/** Every boundary module: one that stands for the simulation's own edge and is handed its conditions. */
const BOUNDARY = [
  "world.trade: every:factory",
  "world.trade: future",
  "world.weather: future",
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

test("the Rust world's actor kinds declare only the keepers and boundaries listed here, each with its reason (the port's backstop)", () => {
  // (Declarations a Rust kind makes that its TS module held without declaring, each with its reason: allowed here only,
  // and added to the lists above when the TS modules go. world.vendor: the technology on offer is the outside world's,
  // as world prices are; the TS vendor kept it undeclared. 2026-10-18, integration.)
  // (firm.provider: the assistants on offer are the outside world's technology, as world.vendor's systems are; 2026-10-31.)
  const RUST_ONLY = ["world.vendor: technology on offer", "firm.provider: assistants on offer"];
  const allowed = new Set([...KEEPERS, ...BOUNDARY, ...RUST_ONLY]);
  for (const m of rustManifests()) for (const k of [...(m.keeps ?? []), ...(m.boundary ?? [])]) {
    expect(allowed.has(line(m.name, k.what)), `${line(m.name, k.what)}: a Rust kind's declaration not in the list`).toBe(true);
    expect(k.why.length).toBeGreaterThan(40);
  }
  // (And each says it as its TS module does, while both exist.)
  for (const m of rustManifests()) {
    const ts = Object.values(modules).find((x) => x.name === m.name);
    if (ts) for (const field of ["keeps", "boundary"] as const) expect((m[field] ?? []).map((k) => k.what).filter((w) => !RUST_ONLY.includes(line(m.name, w))).sort()).toEqual((ts[field] ?? []).map((k) => k.what).sort());
  }
});

test("no kind of participant is shown a whole register, population or map, or the run's future, unless it keeps it and says so", () => {
  const allowed = new Set([...KEEPERS, ...BOUNDARY]);
  const undeclared = found().filter((v) => !allowed.has(line(v.module, v.what)))
    .map((v) => `${line(v.module, v.what)} (${v.through}, at ${v.seat}${v.seats > 1 ? ` and ${v.seats - 1} more` : ""})`).sort();
  // Every whole view is a keeper's or a boundary module's. (Until 2026-10-08 a list here held the 81 views still owed;
  // the last went with the land registry and the electoral commission becoming bodies of their own.)
  expect(undeclared).toEqual([]);
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

test("nobody is shown anyone's own record but their own: the only channel that shows a record names nobody, and no office has one", () => {
  // (docs/design/ai-citizens.md 10d. That the kernel shows through it only the looker's own, and refuses a record set
  // by anyone a model runs: kernel/tests/entity_record.rs.)
  const schema = JSON.parse(readFileSync(join(root, "contracts/world-config.schema.json"), "utf8"));
  const own = schema.$defs.Channel.oneOf.filter((c: any) => c.properties.kind.const === "own_record");
  expect(own.length).toBe(1);
  // It can say how often and whether on request, and nothing about whose.
  expect(Object.keys(own[0].properties).sort()).toEqual(["every", "id", "kind", "on_request", "title"]);
  expect(own[0].additionalProperties).toBe(false);
  // No other kind of channel has anything to do with records of this kind: what a records channel matches is the
  // world's papers (claims, agreements, statements ...), a closed list.
  const kinds = schema.$defs.Channel.oneOf.find((c: any) => c.properties.kind.const === "records" && c.properties.way.const === "mine").properties.match.properties.records.items.enum;
  expect(kinds.some((k: string) => k.includes("entity_record") || k.includes("own_record"))).toBe(false);
  for (const town of towns()) {
    // In the generated town nobody is handed one yet (a code mind wrote its record and needs no telling); and no
    // position ever could be: an office's channels pass to its next holder, and a record is a person's.
    for (const p of town.positions) expect((p.channels ?? []).some((c: any) => c.kind === "own_record")).toBe(false);
    for (const p of town.participants) for (const c of p.channels ?? []) if (c.kind === "own_record") expect(p.kind).toBe("person");
    // And no parameter hands a module anyone's values, trust or views but the person's own.
    for (const p of town.participants) {
      const params = JSON.stringify(p.controller?.params ?? {});
      if (p.kind !== "person") expect(params.includes("own_values")).toBe(false);
    }
  }
});

test("an office's own file (what a seat is shown of what it sent, filed and paid) is made only of what the seat was shown: its own papers and accounts, and nothing of anyone else's", () => {
  // (docs/behaviour/office-books.md, "The office's own file". The file is kept by code from the observations the seat
  // receives; it asks the engine for nothing, so it can hold no more than the seat's channels carried.)
  const me = "landlord-1", seat = "landlord-1-office-system";
  const obs = (records: object[], transactions: object[]): any => ({ t: 5 * 86_400, entity: me, inbox: [], outcomes: [], drafts: [],
    channels: { "landlord-1-office/mine": { kind: "records", records },
      "landlord-1-office/books": { kind: "accounts", accounts: [{ account: "acc-landlord-1", holder: me, custodian: "bank", currency: "KES", balance: "1" }], transactions } } });
  const book = new DayBook({ entity: me, authors: [seat] });
  book.absorb(obs([
    { id: "rec.1", record: "statement", kind: "notice", author: seat, speaks_for: me, at: 86_400, text: "Our own notice.", visible_to: [me] },
    { id: "rec.2", record: "statement", kind: "complaint", author: "c0009-self", speaks_for: "c0009", at: 86_400, text: "A TENANT'S OWN BUSINESS", visible_to: ["c0009"] },
  ], [
    { t: 86_400, from: "acc-landlord-1", to: "acc-city", amount: "100000", currency: "KES", by: me },
    { t: 86_400, from: "acc-c0001", to: "acc-c0002", amount: "777700", currency: "KES", by: "c0001" },
  ]));
  const text = book.text(5 * 86_400, "Letting office");
  expect(text).toContain("Our own notice.");
  expect(text).toContain("1,000.00 to acc-city");
  expect(text).not.toContain("TENANT");
  expect(text).not.toContain("7,777");
  // A town has no god's-eye register in it by construction: the file has no source but the observation.
  expect(book.text(5 * 86_400, "x")).not.toContain("acc-c0001");
});

// An office's practice and its past (docs/behaviour/culture.md, "An office's practice"; the owner's ruling of 2026-10-13: a seat is
// not shown its office's past practice as ready counts). The way a holder learns how its office has acted is its own files:
// its papers are `mine` and nobody else's, so another office's files are not a report it can be given.
test("a holder looks through its own office's files and no one else's: every `mine` channel of every seat names no one, another office's files are refused by the contract, and an organisation's record is shown to no one", () => {
  const OWN_KEYS = ["id", "kind", "way", "match", "title", "every", "on_request"];
  for (const town of towns()) for (const p of town.positions) for (const c of p.channels ?? []) {
    if (c.kind === "records" && c.way === "mine") {
      for (const k of Object.keys(c)) expect(OWN_KEYS).toContain(k); // (no `of`, `office` or `entity`: nothing to point it at another office)
      expect(JSON.stringify(c.match ?? {}).includes("involving")).toBe(false);
    }
    expect(c.kind).not.toBe("org_record"); // (an organisation's record, its practice with it, has no channel at all)
  }
  // The contract's own example of a channel aimed at another office's files is invalid (contracts/test runs every invalid example).
  const ex = JSON.parse(readFileSync(join(root, "contracts/examples/invalid/world-config/files-of-another-office.json"), "utf8"));
  expect(JSON.stringify(ex)).toContain('"of": "office-2"'.replace(/ /g, "")) ;
});

// Culture (docs/behaviour/culture.md; design 14): what a person takes those around them to do and approve of is one person's
// belief, kept in their own record, moved only along a tie, by being there, or by what is published. Nothing is the
// town's, no register is read, and no channel is added.
test("culture adds no whole view, no channel and no register: a town with the dial on shows the same keepers, and a picture refuses any other route", () => {
  const base = { ...spec, factories: 5 };
  const channelsOf = (town: any) => JSON.stringify([town.positions.map((p: any) => p.channels), town.participants.map((p: any) => p.channels)]);
  const off = generate({ ...base, living: { culture: false } }), on = generate({ ...base, living: { culture: true } }); // (a living town either way: only the dial differs)
  expect(wholeViews(on).map((v) => `${v.module}: ${v.what}`).sort()).toEqual(wholeViews(off).map((v) => `${v.module}: ${v.what}`).sort());
  expect(channelsOf(on)).toBe(channelsOf(off)); // (no channel is added)
  // What a person holds is in their own params and record: nobody's params list another's group or picture.
  for (const x of on.participants.filter((p: any) => p.kind === "person")) expect(x.controller.params.origin === undefined || typeof x.controller.params.origin === "string").toBe(true);
  // The arithmetic refuses every route but the three: held by kernel/crates/actors/src/mind/culture.rs, `a_route_outside_the_three_is_refused`.
});

// Town memory (docs/behaviour/culture.md; design 14e): what a person remembers of what was public reaches them only by being there (the world shows
// who left a building to those inside it), by what was published, or from a tie; the memory has no other way in, holds a few slots, and passes
// nothing on past a few hands. A look from outside shows only that someone was seen leaving, never who or why.
test("town memory adds no channel and no register: events come in only seen, read or told, a few are held, and none is passed far", () => {
  const base = { ...spec, factories: 5 };
  const channelsOf = (town: any) => JSON.stringify([town.positions.map((p: any) => p.channels), town.participants.map((p: any) => p.channels)]);
  expect(channelsOf(generate({ ...base, living: { culture: true } }))).toBe(channelsOf(generate({ ...base, living: { culture: false } })));
  // Events come in only seen, read or told, a few are held, and none is passed far: kernel/crates/actors/src/mind/townmemory.rs,
  // `never_more_than_six_the_weakest_gives_way` and `nothing_past_three_hands_and_told_is_a_part_of_the_tellers_strength`.
});

// Events join the picture (docs/behaviour/culture.md): an event that is an instance of a conduct moves a picture only by the three routes, once, and only
// the two kinds that show a conduct do it; a register, a directory or a count cannot.
test("an event moves a picture only along a tie, by being there or by what is published, and only a removal and a walk-out show a conduct", () => {
  // (The routes are refused by kernel/crates/actors/src/mind/culture.rs, `a_route_outside_the_three_is_refused`; only a removal and a walk-out show a conduct:
  // mind/townmemory.rs, `only_a_removal_and_a_walk_out_show_a_conduct_and_trust_goes_by_ones_own_view`.)
});

// Ordinary talk about others' conduct (docs/behaviour/culture.md, "Ordinary talk"): a person tells of a third person's act only if that person told it to
// them (a tie), only of the acts they keep (a few people's, for a few months), never of the asker, and what the hearer learns moves their own picture along
// a tie. No channel is added, no register is read, and a stranger cannot be told of from nothing.
test("ordinary talk adds no channel and no register: a person can tell only of what a tie told them of themself, and a hearer learns it along a tie", () => {
  const base = { ...spec, factories: 5 };
  const channelsOf = (town: any) => JSON.stringify([town.positions.map((p: any) => p.channels), town.participants.map((p: any) => p.channels)]);
  expect(channelsOf(generate({ ...base, living: { culture: true } }))).toBe(channelsOf(generate({ ...base, living: { culture: false } })));
  // What a person can tell, and to whom, is the engine's: kernel/crates/actors/src/mind/culture.rs, `gossip_only_of_what_a_tie_told_me_once_to_each_not_past_gossip_days`
  // (nothing told, nothing to tell, the draw never made; a hearer learns along a tie only: `a_route_outside_the_three_is_refused`).
});
