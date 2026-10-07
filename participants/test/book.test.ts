// A book's lookups (participants/src/behaviour/common.ts): what it keeps so as not to look through everything it has
// seen each time it's asked (a lot by a cell, claims by who holds them, a seller's latest list) must answer exactly
// as looking through everything does, whatever arrives in whatever order. Checked against the plain way, over a
// seeded stream of records with everything that makes the two differ if one is wrong: lots that overlap, records
// withdrawn before and after they're seen, claims released and transferred, lists made at the same time.

import { expect, test } from "bun:test";
import type { Observation, Record, StatementRecord } from "../src/contracts";
import { Book, lotOf } from "../src/behaviour/common";
import { ownerOf } from "../src/behaviour/institutions";
import { goodsPrices, offerOf } from "../src/behaviour/trade";
import { standingClaims } from "../src/law";
import { Randomness } from "../src/rng";

const obs = (t: number, records: any[]): Observation => ({ t, entity: "city", channels: { all: { kind: "records", records } }, outcomes: [], inbox: [], participant: "p" }) as unknown as Observation;

/** The plain ways: each as the modules worked it out before the book kept anything for it. */
const plain = {
  open: (book: Book, kind: string) => book.all(kind).filter((r) => !book.withdrawn.has(r.id)),
  lotOf: (book: Book, cell: string) => plain.open(book, "lot").find((l) => (l.data?.cells as string[] | undefined)?.includes(cell))?.id,
  ownerOf(book: Book, lot: string): string | undefined {
    let holder: string | undefined;
    const titles = standingClaims([...book.ofType("claim"), ...book.ofType("claim_release"), ...book.ofType("withdrawal")]).filter((c) => c.about?.kind === "ownership" && c.about?.object === lot);
    for (const c of titles) holder = c.holder;
    for (const r of book.ofType("claim_transfer")) {
      const c = titles.find((x) => x.id === r.claim);
      if (c && (r.speaks_for === holder || r.speaks_for === c.speaks_for)) holder = r.to;
    }
    return holder;
  },
  goods: (book: Book, seller: string) => plain.open(book, "price_list").filter((r) => r.speaks_for === seller && r.data?.goods).sort((a, b) => b.at - a.at)[0],
  offer: (book: Book, seller: string) => plain.open(book, "price_list").filter((l) => l.speaks_for === seller && l.offer).sort((a, b) => b.at - a.at)[0]?.offer,
};

/** A stream of records, seeded: `n` of them, in batches, each batch one look. */
function stream(seed: bigint, n: number): any[][] {
  const rng = new Randomness(seed).stream(["book-test"]);
  const pick = <T>(xs: T[]): T => xs[rng.below(xs.length)]!;
  const people = ["a", "b", "c", "d", "city"];
  const cells = Array.from({ length: 12 }, (_, i) => `cell.${i % 4}.${Math.floor(i / 4)}`);
  const made: any[] = [];
  const base = (i: number, t: number) => ({ id: `rec.${i}`, at: t, author: `${pick(people)}-self`, visible_to: "public" });
  for (let i = 1; i <= n; i++) {
    const t = Math.floor(i / 3) * 100; // (several at the same time: ties)
    const roll = rng.below(100);
    const earlier = (ok: (r: any) => boolean) => { const xs = made.filter(ok); return xs.length ? pick(xs) : undefined; };
    if (roll < 25) made.push({ ...base(i, t), record: "statement", kind: "lot", speaks_for: "city", text: "A lot.", data: rng.below(10) === 0 ? {} : { cells: Array.from({ length: 1 + rng.below(3) }, () => pick(cells)) } });
    else if (roll < 45) made.push({ ...base(i, t), record: "claim", speaks_for: pick(["city", "a"]), position: "right", holder: pick(people), ...(rng.below(3) === 0 ? { counterparty: pick(people) } : {}),
      about: { kind: pick(["ownership", "ownership", "debt", "rates"]), object: `rec.${1 + rng.below(i)}`, amount: "100" } });
    else if (roll < 60) made.push({ ...base(i, t), record: "statement", kind: "price_list", ...(rng.below(8) === 0 ? {} : { speaks_for: pick(people) }), text: "Prices.",
      data: rng.below(4) === 0 ? {} : { goods: { bread: 100 + i }, account: `acc-${i}` }, ...(rng.below(3) === 0 ? { offer: { by: "x", take_up: "order", terms: { commitments: [], n: i } } } : {}) });
    else if (roll < 75) {
      // A withdrawal: of something made already, or (now and then) of something not yet made or never to be.
      const target = rng.below(5) === 0 ? `rec.${i + 1 + rng.below(4)}` : earlier((r) => r.record === "statement" || r.record === "claim")?.id ?? `rec.${i + 1}`;
      made.push({ ...base(i, t), record: "withdrawal", withdraws: target });
    } else if (roll < 82) made.push({ ...base(i, t), record: "claim_release", claim: earlier((r) => r.record === "claim")?.id ?? "rec.0" });
    else if (roll < 95) {
      const c = earlier((r) => r.record === "claim");
      made.push({ ...base(i, t), record: "claim_transfer", claim: c?.id ?? "rec.0", to: pick(people), speaks_for: pick([c?.holder ?? "a", c?.speaks_for ?? "city", pick(people)]) });
    } else made.push({ ...base(i, t), record: "statement", kind: "notice", text: "Something else." });
  }
  // Seen in batches, out of the order made now and then (a withdrawal can come before what it withdraws), and some twice.
  const looks: any[][] = [];
  for (let at = 0; at < made.length; ) {
    const size = 1 + rng.below(6);
    const batch = made.slice(at, at + size);
    if (rng.below(4) === 0) batch.reverse();
    if (rng.below(6) === 0 && at > 0) batch.push(made[rng.below(at)]);
    looks.push(batch);
    at += size;
  }
  return looks;
}

/** Every answer the kept lookups give, beside the plain way's, for a book as it stands. */
function compare(book: Book, asked: { cells: string[]; people: string[]; ids: string[] }) {
  for (const kind of ["lot", "price_list", "notice", "none-of-these"]) expect(book.open(kind)).toEqual(plain.open(book, kind));
  for (const cell of asked.cells) expect(lotOf(book, cell)).toBe(plain.lotOf(book, cell));
  for (const who of asked.people) {
    expect([...book.claimsBy("holder", who)]).toEqual(book.ofType("claim").filter((c) => c.holder === who));
    expect([...book.claimsBy("counterparty", who)]).toEqual(book.ofType("claim").filter((c) => c.counterparty === who));
    const list = plain.goods(book, who);
    expect(goodsPrices(book, who)).toEqual({ prices: (list?.data?.goods as any) ?? {}, account: list?.data?.account, min_order: list?.data?.min_order, at: list?.data?.at });
    expect(offerOf(book, who)).toBe(plain.offer(book, who) as any);
  }
  for (const id of asked.ids) {
    expect([...book.claimsBy("object", id)]).toEqual(book.ofType("claim").filter((c) => (c.about as any)?.object === id));
    expect(ownerOf(book, id)).toBe(plain.ownerOf(book, id));
  }
}

test("a book's kept lookups answer as looking through everything does", () => {
  for (const seed of [1n, 2n, 3n, 4n, 5n, 6n]) {
    const looks = stream(seed, 240);
    const cells = Array.from({ length: 13 }, (_, i) => `cell.${i % 4}.${Math.floor(i / 4)}`);
    // Three readers of the same stream: one asked about everything from the start (so everything is kept as it
    // arrives), one asked only at the end (everything made then, at once), one asked about a little, then more (few
    // values kept one by one, then every value's).
    const [early, late, growing] = [new Book(), new Book(), new Book()];
    const everything = { cells, people: ["a", "b", "c", "d", "city", "nobody"], ids: Array.from({ length: 40 }, (_, i) => `rec.${i * 6 + 1}`) };
    let t = 0;
    for (const [i, batch] of looks.entries()) {
      t += 100;
      for (const book of [early, late, growing]) book.absorb(obs(t, batch));
      compare(early, everything);
      compare(growing, { cells: cells.slice(0, 2), people: ["a"], ids: everything.ids.slice(0, i < looks.length / 2 ? 3 : 20) });
    }
    compare(late, everything);
    compare(growing, everything);
  }
});

test("a lot whose cells aren't a list is still found as looking through the lots finds it", () => {
  const book = new Book();
  const lot = (id: string, cells: unknown): StatementRecord => ({ id, at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "A lot.", data: { cells } }) as unknown as StatementRecord;
  book.absorb(obs(0, [lot("lot-1", ["cell.1.1"]), lot("lot-2", "cell.2.2 and cell.3.3")]));
  for (const cell of ["cell.1.1", "cell.2.2", "cell.3.3", "cell.9.9"]) expect(lotOf(book, cell)).toBe(plain.lotOf(book, cell));
  expect(lotOf(book, "cell.2.2")).toBe("lot-2");
  book.absorb(obs(1, [lot("lot-3", ["cell.9.9"])]));
  expect(lotOf(book, "cell.9.9")).toBe("lot-3");
});

test("what a book hands out as a copy can be sorted without changing what it hands out next", () => {
  const book = new Book();
  const list = (id: string, at: number): Record => ({ id, at, author: "genesis", record: "statement", kind: "price_list", speaks_for: "shop", visible_to: "public", text: "Prices.", data: { goods: { bread: at } } }) as unknown as Record;
  book.absorb(obs(0, [list("l1", 1), list("l2", 3), list("l3", 2)]));
  expect(book.open("price_list").sort((a, b) => b.at - a.at).map((r) => r.id)).toEqual(["l2", "l3", "l1"]);
  expect(book.open("price_list").map((r) => r.id)).toEqual(["l1", "l2", "l3"]);
});
