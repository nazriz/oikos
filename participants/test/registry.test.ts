// The registrar of deaths and the land registry (docs/behaviour/institutions.md, ownership.md): registering a death,
// the registrar applies to the land registry for the dead person's land to pass to their heir (the partner; else the
// eldest adult child; else the town); the land registry, which keeps the register, enters the transmission of each
// title they held and tells those who keep a roll from such notices. A death reported a second time is not registered
// again: the later informant is sent a certified copy.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { Book } from "../src/shared/common";
import { Randomness } from "../src/rng";
import { engine } from "./engine";
const landRegistry = engine("land.registry");
const registry = engine("city.registry");

const ctx: any = { participant: "registry-system", entity: "city", rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 0 }, params: {} };
const lot = { id: "lot-1", at: 0, author: "genesis", record: "statement", speaks_for: "land-registry", kind: "lot", visible_to: "public", text: "Lot 1.", data: { cells: ["cell.1.1"] } };
const title = { id: "title-lot-1", at: 0, author: "genesis", record: "claim", speaks_for: "land-registry", position: "right", holder: "c0001", visible_to: "public", about: { kind: "ownership", object: "lot-1" } };
const notice = (data: object) => ({ id: "rec.5", at: 100, author: "c0002-self", record: "statement", speaks_for: "c0002", kind: "death_notification", addressed_to: ["city"], visible_to: ["city"], text: "A death.", data });
const obs = (records: any[]): Observation => ({ t: 200, entity: "city", channels: { all: { kind: "records", records } }, outcomes: [], inbox: [], participant: "registry-system", woke_for: "news" }) as unknown as Observation;
const calls = (records: any[], module: any = registry, params: object = { land_registry: "land-registry" }, entity = "city") => {
  const m = module.create({ ...ctx, entity, params });
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a: any = m.step({ ...obs(i === 0 ? records : []), entity } as Observation, ctx);
    if (a.type === "wait") break;
    out.push(a.call);
  }
  return out.join("\n");
};

test("registering a death, the registrar applies to the land registry for the land to pass to the partner, else the eldest adult child, else the town", () => {
  const applied = (data: object) => calls([notice(data)]);
  expect(applied({ deceased: "c0001", partner: "c0002", adult_children: ["c0003"] })).toContain('statement(basis=rec.5, data={"deceased":"c0001","heir":"c0002"}, kind=transmission_application');
  expect(applied({ deceased: "c0001", adult_children: ["c0003", "c0004"] })).toContain('"heir":"c0003"');
  expect(applied({ deceased: "c0001" })).toContain('"heir":"city"');
  // It is shown no titles, and enters no transfer itself.
  expect(calls([lot, title, notice({ deceased: "c0001", partner: "c0002" })])).not.toContain("transfer=");
  // A world with no land registry: nothing is applied for.
  expect(calls([notice({ deceased: "c0001" })], registry, {})).not.toContain("transmission_application");
});

test("the land registry enters the transmission of each title the dead person held, and tells those who keep a roll", () => {
  const application = (deceased: string, heir: string) => ({ id: "rec.6", at: 150, author: "registry-system", record: "statement", speaks_for: "city", kind: "transmission_application", addressed_to: ["land-registry"], visible_to: ["city", "land-registry"], text: "x", data: { deceased, heir } });
  const done = calls([lot, title, application("c0001", "c0002")], landRegistry, { notify: ["outside", "water-corp"] }, "land-registry");
  expect(done).toContain("claim(basis=rec.6, to=c0002, transfer=title-lot-1)");
  // Someone who held nothing: nothing passes.
  expect(calls([lot, title, application("c0009", "c0002")], landRegistry, {}, "land-registry")).not.toContain("transfer=");
  // A sale it sees entered in its register: a notice of acquisition to those it tells, seen by them alone.
  const sale = { id: "rec.7", at: 160, author: "c0001-self", record: "claim_transfer", speaks_for: "c0001", claim: "title-lot-1", to: "c0005", visible_to: "public" };
  const told = calls([lot, title, sale], landRegistry, { notify: ["outside", "water-corp"] }, "land-registry");
  expect(told).toContain('kind=acquisition_notice');
  expect(told).toContain('"lot":"lot-1","owner":"c0005","title":"title-lot-1"');
  expect(told).toContain('visible=["land-registry","outside","water-corp"]');
  expect(calls([lot, title, sale], landRegistry, {}, "land-registry")).not.toContain("acquisition_notice");
});

test("a death reported again is not registered twice: the later informant is sent a certified copy of the entry", () => {
  const entry = { id: "rec.9", at: 120, author: "registry-system", record: "statement", speaks_for: "city", kind: "death_registration", addressed_to: ["police"], visible_to: ["city", "police"], text: "x", data: { deceased: "c0001", reported_by: "police" } };
  const again = { ...notice({ deceased: "c0001" }), id: "rec.10", speaks_for: "landlord-1", author: "landlord-1-office-system" };
  const out = calls([entry, again]);
  expect(out).toContain("kind=death_certificate");
  expect(out).toContain('to=["landlord-1"]');
  expect(out).not.toContain("kind=death_registration");
  // Whoever was sent the entry needs no copy.
  expect(calls([entry, { ...again, speaks_for: "police" }])).not.toContain("death_certificate");
});

test("a death's entry is sent to those concerned, never published: whoever reported it, those they named, those sent every entry, and, with no family, those the town writes to for the estate", () => {
  const entry = (params: object, data: object) => {
    const m = registry.create({ ...ctx, params });
    const a: any = m.step(obs([notice(data)]), ctx);
    return a.call as string;
  };
  const world = { feeds: ["outside"], estate_tells: ["bank", "energy-co"] };
  // Reported by the family (it says who the children are, if none): the reporter, whom they named, and the feed.
  const family = entry(world, { deceased: "c0001", partner: "c0002", children: [], adult_children: [], tell: ["bank", "school"] });
  expect(family).toContain('to=["c0002","bank","school","outside"]');
  expect(family).toContain('visible=["city","c0002","bank","school","outside"]');
  expect(family).not.toContain("visible=public");
  // Reported by someone else (a landlord, the police): nobody named, so the town writes to the bank and the utilities.
  const alone = entry(world, { deceased: "c0001" });
  expect(alone).toContain('to=["c0002","outside","bank","energy-co"]');
  // A world that gives the registry nobody to tell: the reporter alone.
  expect(entry({}, { deceased: "c0001" })).toContain('to=["c0002"]');
});

// BLOCKED: this case read the deleted TypeScript library's `ownerOf` directly; the engine's is `owner_of` (kernel/crates/actors/src/offices/land.rs),
// which no Rust test yet holds to a stranger's transfer, the registry's transmission and the new holder's sale. Kept, skipped, until one does.
const ownerOf = (_book: Book, _lot: string): string | undefined => { throw new Error("blocked: ownerOf is not in TypeScript now"); };
// PORT NEEDED (cut-over, held as test.skip): the TypeScript helper this case called is gone and no engine test judges the same; docs/risks.md, MT-18.
test.skip("a title's transfer counts only from its holder, or from whoever issued it", () => {
  const book = new Book();
  const by = (who: string, to: string, id: string) => ({ id, at: 300, author: "x", record: "claim_transfer", speaks_for: who, claim: "title-lot-1", to, visible_to: "public" });
  book.absorb(obs([lot, title, by("c0009", "c0009", "rec.6")]));
  expect(ownerOf(book, "lot-1")).toBe("c0001"); // (a stranger's transfer: nothing)
  book.absorb(obs([by("land-registry", "c0002", "rec.7")]));
  expect(ownerOf(book, "lot-1")).toBe("c0002"); // (the registry's transmission)
  book.absorb(obs([by("c0002", "c0003", "rec.8")]));
  expect(ownerOf(book, "lot-1")).toBe("c0003"); // (the new holder's sale)
});
