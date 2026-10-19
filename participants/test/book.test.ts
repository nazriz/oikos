// A book's lookups (participants/src/shared/common.ts): what it keeps so as not to look through everything it has
// seen each time it's asked (a lot by a cell, claims by who holds them, a seller's latest list) must answer exactly
// as looking through everything does, whatever arrives in whatever order. Checked against the plain way, over a
// seeded stream of records with everything that makes the two differ if one is wrong: lots that overlap, records
// withdrawn before and after they're seen, claims released and transferred, lists made at the same time.

import { expect, test } from "bun:test";
import type { Observation, Record, StatementRecord } from "../src/contracts";
import { Book, SHELF } from "../src/shared/common";
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
  for (const who of asked.people) {
    expect([...book.claimsBy("holder", who)]).toEqual(book.ofType("claim").filter((c) => c.holder === who));
    expect([...book.claimsBy("counterparty", who)]).toEqual(book.ofType("claim").filter((c) => c.counterparty === who));
    const list = plain.goods(book, who);
  }
  for (const id of asked.ids) {
    expect([...book.claimsBy("object", id)]).toEqual(book.ofType("claim").filter((c) => (c.about as any)?.object === id));
  }
}

test("a book's kept lookups answer as looking through everything does", () => {
  for (const seed of [1n, 2n, 3n, 4n, 5n, 6n]) {
    const looks = stream(seed, 240);
    const cells = Array.from({ length: 13 }, (_, i) => `cell.${i % 4}.${Math.floor(i / 4)}`);
    // Three readers of the same stream: one asked about everything from the start (so everything is kept as it
    // arrives), one asked only at the end (everything made then, at once), one asked about a little, then more.
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

// ---------------------------------------------------------------- shelves: what books shown the same list hold in common
//
// A long list shown in one look (a register) is held once, on a shelf, for every book shown it. Nothing a book answers
// may depend on that: so each book here has a twin kept the plain way (every record it has seen in one list, taken in
// one by one, and everything asked of it found by looking through that list), and the two must agree on everything,
// look after look. The readers are shown the same register differently: whole; after some of it one by one; with
// records of their own in among it; later and longer; in two halves; twice in one look; and never in one piece.

/** A book kept the plain way: as `Book` took records in before it kept anything for looking them up. */
class Plain {
  seen: any[] = [];
  ids = new Map<string, any>();
  withdrawn = new Set<string>();
  withdrawnAt = new Map<string, number>();
  replacedBy = new Map<string, string>();
  released = new Set<string>();
  signatures = new Map<string, Set<string>>();
  signedTimes = new Map<string, number[]>();
  notices = new Map<string, { as: string; at: number }[]>();
  withPractice = new Map<string, any>();
  withAssertion = new Map<string, any>();
  private takeDown(id: string, at: number) {
    this.withdrawn.add(id);
    if (!this.withdrawnAt.has(id)) this.withdrawnAt.set(id, at);
    this.withPractice.delete(id);
    this.withAssertion.delete(id);
  }
  absorb(lists: any[][]): any[] {
    const fresh: any[] = [];
    for (const r of lists.flat()) {
      if (this.ids.has(r.id)) continue;
      this.ids.set(r.id, r);
      this.seen.push(r);
      fresh.push(r);
      if (r.record === "claim_release") this.released.add(r.claim);
      if (r.record === "withdrawal") this.takeDown(r.withdraws, r.at);
      if (r.record === "statement" && typeof r.data?.replaces === "string") {
        const old = this.ids.get(r.data.replaces);
        if (old?.record === "statement" && old.kind === r.kind && !!old.speaks_for && old.speaks_for === r.speaks_for) {
          this.replacedBy.set(old.id, r.id);
          this.takeDown(old.id, r.at);
        }
      }
      if (r.record === "signature") {
        this.signatures.set(r.agreement, (this.signatures.get(r.agreement) ?? new Set()).add(r.as));
        this.signedTimes.set(r.agreement, [...(this.signedTimes.get(r.agreement) ?? []), r.at]);
      }
      if (r.record === "statement" && !this.withdrawn.has(r.id)) {
        if (r.practice) this.withPractice.set(r.id, r);
        if (r.assertion) this.withAssertion.set(r.id, r);
      }
      if (r.record === "notice") this.notices.set(r.agreement, [...(this.notices.get(r.agreement) ?? []), { as: r.as, at: r.at }]);
    }
    return fresh;
  }
  all = (kind: string) => this.seen.filter((r) => r.record === "statement" && r.kind === kind);
  open = (kind: string) => this.all(kind).filter((r) => !this.withdrawn.has(r.id));
  ofType = (type: string) => this.seen.filter((r) => r.record === type);
  lotOf = (cell: string) => this.open("lot").find((l) => l.data?.cells?.includes(cell))?.id;
  ownerOf(lot: string): string | undefined {
    let holder: string | undefined;
    const titles = standingClaims(this.seen).filter((c) => c.about?.kind === "ownership" && c.about?.object === lot);
    for (const c of titles) holder = c.holder;
    for (const r of this.ofType("claim_transfer")) {
      const c = titles.find((x) => x.id === r.claim);
      if (c && (r.speaks_for === holder || r.speaks_for === c.speaks_for)) holder = r.to;
    }
    return holder;
  }
  current(id: string) {
    let at = id;
    for (let i = 0; i < 1000 && this.replacedBy.has(at); i++) at = this.replacedBy.get(at)!;
    return this.withdrawn.has(at) ? undefined : this.ids.get(at);
  }
}

const KINDS = ["lot", "price_list", "law", "teaching", "gathering", "notice", "none-of-these"];
const TYPES = ["statement", "claim", "claim_release", "claim_transfer", "withdrawal", "signature", "notice", "agreement"];
const PEOPLE = ["a", "b", "c", "d", "city", "nobody"];
const CELLS = Array.from({ length: 13 }, (_, i) => `cell.${i % 4}.${Math.floor(i / 4)}`);
const ids = (xs: Iterable<{ id: string }>) => [...xs].map((r) => r.id);

/** `n` more records of every sort a book does something with, numbered from `from`, about themselves and `made` before them. */
function more(rng: ReturnType<Randomness["stream"]>, made: any[], from: number, n: number): any[] {
  const pick = <T>(xs: T[]): T => xs[rng.below(xs.length)]!;
  const out: any[] = [];
  for (let i = from; i < from + n; i++) {
    const t = Math.floor(i / 3) * 100;
    const base = { id: `rec.${i}`, at: t, author: `${pick(PEOPLE)}-self`, visible_to: "public" };
    const earlier = (ok: (r: any) => boolean) => { const xs = [...made, ...out].filter(ok); return xs.length ? pick(xs) : undefined; };
    const any = () => (rng.below(6) === 0 ? `rec.${i + 1 + rng.below(5)}` : `rec.${1 + rng.below(i)}`); // (now and then: one not yet made)
    const roll = rng.below(100);
    if (roll < 22) out.push({ ...base, record: "statement", kind: "lot", speaks_for: "city", text: "A lot.", data: rng.below(12) === 0 ? {} : rng.below(40) === 0 ? { cells: `${pick(CELLS)} and ${pick(CELLS)}` } : { cells: Array.from({ length: 1 + rng.below(3) }, () => pick(CELLS)) } });
    else if (roll < 40) out.push({ ...base, record: "claim", speaks_for: pick(["city", "a"]), position: "right", holder: pick(PEOPLE), ...(rng.below(3) === 0 ? { counterparty: pick(PEOPLE) } : {}), about: { kind: pick(["ownership", "ownership", "debt"]), object: any() } });
    else if (roll < 52) out.push({ ...base, record: "statement", kind: "price_list", ...(rng.below(8) === 0 ? {} : { speaks_for: pick(PEOPLE) }), text: "Prices.", data: rng.below(4) === 0 ? {} : { goods: { bread: 100 + i }, account: `acc-${i}` }, ...(rng.below(3) === 0 ? { offer: { by: "x", take_up: "order", terms: { commitments: [], n: i } } } : {}) });
    else if (roll < 62) out.push({ ...base, record: "withdrawal", withdraws: any() });
    else if (roll < 67) out.push({ ...base, record: "claim_release", claim: earlier((r) => r.record === "claim")?.id ?? "rec.0" });
    else if (roll < 76) { const c = earlier((r) => r.record === "claim"); out.push({ ...base, record: "claim_transfer", claim: c?.id ?? "rec.0", to: pick(PEOPLE), speaks_for: pick([c?.holder ?? "a", c?.speaks_for ?? "city", pick(PEOPLE)]) }); }
    // A law, which may say it replaces an earlier one (of its speaker's or not; itself, even; or one not yet made).
    else if (roll < 84) out.push({ ...base, record: "statement", kind: "law", speaks_for: pick(["city", "a"]), text: "A law.", ...(rng.below(2) === 0 ? { data: { replaces: rng.below(8) === 0 ? `rec.${i}` : earlier((r) => r.kind === "law")?.id ?? any() } } : {}) });
    else if (roll < 89) out.push({ ...base, record: "statement", kind: pick(["teaching", "gathering"]), speaks_for: pick(PEOPLE), text: "Come.", ...(rng.below(2) === 0 ? { practice: { every: 7 } } : { assertion: { kind: "teaching" } }) });
    else if (roll < 94) out.push({ ...base, record: "signature", agreement: `rec.${1 + rng.below(8)}`, as: pick(PEOPLE) });
    else if (roll < 97) out.push({ ...base, record: "notice", agreement: `rec.${1 + rng.below(8)}`, as: pick(PEOPLE) });
    else out.push({ ...base, record: "statement", kind: "notice", text: "Something else." });
  }
  return out;
}

/** A book and its plain twin agree on everything that can be asked. */
function agree(book: Book, twin: Plain, who: string) {
  const say = (what: string) => `${who}: ${what}`;
  expect(ids(book.records.values()), say("every record, in the order seen")).toEqual(ids(twin.seen));
  expect(book.records.size).toBe(twin.seen.length);
  for (const id of [...twin.ids.keys()].filter((_, i) => i % 7 === 0)) expect(book.records.get(id), say(`record ${id}`)).toBe(twin.ids.get(id));
  for (const id of ["rec.0", "rec.99999"]) expect(book.records.has(id)).toBe(twin.ids.has(id));
  for (const kind of KINDS) {
    expect(ids(book.all(kind)), say(`all ${kind}`)).toEqual(ids(twin.all(kind)));
    expect(ids(book.open(kind)), say(`open ${kind}`)).toEqual(ids(twin.open(kind)));
    expect(ids(book.standingOf(kind)), say(`standing ${kind}`)).toEqual(ids(twin.open(kind)));
  }
  for (const type of TYPES) expect(ids(book.ofType(type as any)), say(`of type ${type}`)).toEqual(ids(twin.ofType(type)));
  for (const who of PEOPLE) {
    expect(ids(book.claimsBy("holder", who)), say(`claims held by ${who}`)).toEqual(ids(twin.ofType("claim").filter((c) => c.holder === who)));
    expect(ids(book.claimsBy("counterparty", who))).toEqual(ids(twin.ofType("claim").filter((c) => c.counterparty === who)));
    const lists = twin.open("price_list").filter((r) => r.speaks_for === who);
    const goods = lists.filter((r) => r.data?.goods).sort((a, b) => b.at - a.at)[0];
  }
  for (const id of [...twin.ids.keys()].filter((_, i) => i % 5 === 0)) {
    expect(ids(book.claimsBy("object", id)), say(`claims about ${id}`)).toEqual(ids(twin.ofType("claim").filter((c) => c.about?.object === id)));
    expect(book.current(id), say(`what stands for ${id}`)).toBe(twin.current(id));
    expect(book.repealed(id)).toBe(twin.withdrawn.has(id) && !twin.current(id));
  }
  expect([...book.withdrawn], say("withdrawn")).toEqual([...twin.withdrawn]);
  expect([...book.withdrawnAt], say("withdrawn when")).toEqual([...twin.withdrawnAt]);
  expect([...book.replacedBy], say("replaced by")).toEqual([...twin.replacedBy]);
  expect([...book.released]).toEqual([...twin.released]);
  expect([...book.signatures].map(([a, s]) => [a, [...s]]), say("signatures")).toEqual([...twin.signatures].map(([a, s]) => [a, [...s]]));
  expect([...book.signedTimes]).toEqual([...twin.signedTimes]);
  expect([...book.notices]).toEqual([...twin.notices]);
  expect(ids(book.practices()), say("practices")).toEqual(ids(twin.withPractice.values()));
  expect(ids(book.assertions()), say("assertions")).toEqual(ids(twin.withAssertion.values()));
}

test("books that read a list from one shelf answer as books that each took it in record by record", () => {
  SHELF.least = 64; // (shelves of lists this short, for this file: the default asks for longer)
  for (const seed of [11n, 12n, 13n, 14n, 15n]) {
    const rng = new Randomness(seed).stream(["shelf-test"]);
    const first = more(rng, [], 1, 40); // (before the register: what some have seen one by one)
    const register = more(rng, first, 41, 180 + rng.below(120));
    const tail = more(rng, [...first, ...register], 41 + register.length, 30);
    const after = more(rng, [...first, ...register, ...tail], 41 + register.length + 30, 60);
    const own = (who: string, i: number) => ({ id: `own.${who}.${i}`, at: 5, author: `${who}-self`, visible_to: [who], record: "claim", speaks_for: who, position: "right", holder: who, counterparty: "city", about: { kind: "debt", object: `rec.${i}` } });
    const readers = ["whole", "some first", "own among it", "later and longer", "halves", "twice", "piecemeal", "other first", "out of order"].map((name) => ({ name, book: new Book(), twin: new Plain() }));
    const look = (who: string, t: number, ...lists: any[][]) => {
      const r = readers.find((x) => x.name === who)!;
      const channels = Object.fromEntries(lists.map((records, i) => [`ch${i}`, { kind: "records", records }]));
      const fresh = r.book.absorb({ t, entity: "city", channels, outcomes: [], inbox: [], participant: "p" } as unknown as Observation);
      expect(ids(fresh), `${who}: what was new`).toEqual(ids(r.twin.absorb(lists)));
      agree(r.book, r.twin, who);
    };
    const some = (xs: any[], one_in: number) => xs.filter(() => rng.below(one_in) === 0);
    const mine = [own("b", 1), own("b", 2), own("b", 3)];
    look("whole", 0, register);
    // Some of the register one by one beforehand (a withdrawal before what it withdraws, a law after the one that replaces it...).
    look("some first", 0, first.slice(0, 10), some(register, 9).reverse());
    look("some first", 1, register);
    // Its own records in among the register's: two it has seen, one it hasn't (which is new to it there and then).
    look("own among it", 0, mine.slice(0, 2), some(register, 15));
    look("own among it", 1, [...register.slice(0, 50), mine[0], ...register.slice(50, 120), mine[2], mine[1], ...register.slice(120)]);
    look("later and longer", 2, [...register, ...tail]);
    look("halves", 0, register.slice(0, 90));
    look("halves", 1, register);
    look("twice", 0, [...register.slice(0, 70), register[3], register[69], ...register.slice(70), register[0]], register);
    for (let at = 0; at < register.length; at += 40) look("piecemeal", at, register.slice(at, at + 40));
    // Shown something else first that begins as the register does and then differs.
    look("other first", 0, [...register.slice(0, 80), ...first]);
    look("other first", 1, register, tail);
    // The register's records with one of them early (and again in its place): not the shelf's order, though it holds the same.
    look("out of order", 0, [register[0], register[2], register[1], register[2], ...register.slice(3)]);
    // Then the same further records for all, a few at a time (withdrawals of what is on the shelf, lots over its cells, laws replacing its laws).
    const then = [...tail, ...after];
    for (let at = 0, t = 10; at < then.length; t++) {
      const size = 1 + rng.below(9);
      for (const r of readers) look(r.name, t, then.slice(at, at + size));
      at += size;
    }
    // What was shared was shared: the register is on a shelf for those shown it whole, and on no shelf for the one never shown it so.
    const held = (who: string) => readers.find((x) => x.name === who)!.book.held();
    expect(held("whole")).toEqual({ own: then.length, shared: register.length, shelves: 1 });
    expect(held("later and longer").shared).toBe(register.length);
    expect(held("some first").shared).toBeGreaterThan(register.length * 0.7);
    expect(held("own among it").shared).toBeGreaterThan(register.length * 0.2);
    expect(held("piecemeal")).toEqual({ own: register.length + then.length, shared: 0, shelves: 0 });
  }
}, 180_000);

test("what a book hands out as a copy can be sorted without changing what it hands out next", () => {
  const book = new Book();
  const list = (id: string, at: number): Record => ({ id, at, author: "genesis", record: "statement", kind: "price_list", speaks_for: "shop", visible_to: "public", text: "Prices.", data: { goods: { bread: at } } }) as unknown as Record;
  book.absorb(obs(0, [list("l1", 1), list("l2", 3), list("l3", 2)]));
  expect(book.open("price_list").sort((a, b) => b.at - a.at).map((r) => r.id)).toEqual(["l2", "l3", "l1"]);
  expect(book.open("price_list").map((r) => r.id)).toEqual(["l1", "l2", "l3"]);
});
