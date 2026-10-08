// The registry (docs/behaviour/institutions.md): registering a death, it passes the land the deceased held to their heir
// (the partner; else the eldest adult child; else the town) as the land registry, which the land's records then show.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { Book } from "../src/behaviour/common";
import { ownerOf, registry } from "../src/behaviour/institutions";
import { Randomness } from "../src/rng";

const ctx: any = { participant: "registry-system", entity: "city", rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 0 }, params: {} };
const lot = { id: "lot-1", at: 0, author: "genesis", record: "statement", speaks_for: "city", kind: "lot", visible_to: "public", text: "Lot 1.", data: { cells: ["cell.1.1"] } };
const title = { id: "title-lot-1", at: 0, author: "genesis", record: "claim", speaks_for: "city", position: "right", holder: "c0001", visible_to: "public", about: { kind: "ownership", object: "lot-1" } };
const notice = (data: object) => ({ id: "rec.5", at: 100, author: "c0002-self", record: "statement", speaks_for: "c0002", kind: "death_notification", addressed_to: ["city"], visible_to: ["city"], text: "A death.", data });
const obs = (records: any[]): Observation => ({ t: 200, entity: "city", channels: { all: { kind: "records", records } }, outcomes: [], inbox: [], participant: "registry-system", woke_for: "news" }) as unknown as Observation;
const calls = (records: any[]) => {
  const m = registry.create(ctx);
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a: any = m.step(obs(i === 0 ? records : []), ctx);
    if (a.type === "wait") break;
    out.push(a.call);
  }
  return out.join("\n");
};

test("a deceased's land passes to their partner, else their eldest adult child, else the town", () => {
  expect(calls([lot, title, notice({ deceased: "c0001", partner: "c0002", adult_children: ["c0003"] })])).toContain("claim(basis=rec.5, to=c0002, transfer=title-lot-1)");
  expect(calls([lot, title, notice({ deceased: "c0001", adult_children: ["c0003", "c0004"] })])).toContain("to=c0003, transfer=title-lot-1");
  expect(calls([lot, title, notice({ deceased: "c0001" })])).toContain("to=city, transfer=title-lot-1");
  expect(calls([lot, title, notice({ deceased: "c0009", partner: "c0002" })])).not.toContain("transfer=");
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

test("a title's transfer counts only from its holder, or from whoever issued it", () => {
  const book = new Book();
  const by = (who: string, to: string, id: string) => ({ id, at: 300, author: "x", record: "claim_transfer", speaks_for: who, claim: "title-lot-1", to, visible_to: "public" });
  book.absorb(obs([lot, title, by("c0009", "c0009", "rec.6")]));
  expect(ownerOf(book, "lot-1")).toBe("c0001"); // (a stranger's transfer: nothing)
  book.absorb(obs([by("city", "c0002", "rec.7")]));
  expect(ownerOf(book, "lot-1")).toBe("c0002"); // (the registry's transmission)
  book.absorb(obs([by("c0002", "c0003", "rec.8")]));
  expect(ownerOf(book, "lot-1")).toBe("c0003"); // (the new holder's sale)
});
