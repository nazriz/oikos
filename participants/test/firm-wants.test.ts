// What a firm or a landlord wants (docs/behaviour/firm-wants.md): its character is drawn from its owner's values, so
// two shops, and two landlords, alike in everything but their owners do not behave alike. Asked for a rise or to hold
// a rent, one says yes and the other no; a vacant home is listed at a different markup; and an organisation with no
// wants of its own (a town before wants) answers nothing and does as its routines say.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { landlord } from "../src/behaviour/firms";
import { characterOf } from "../src/behaviour/orgwants";
import { retailer } from "../src/behaviour/retailer";
import { inCurrency } from "../src/money";
import { RECORD } from "../src/module";
import { Randomness } from "../src/rng";
import { callsOf, context, DAY, employment, MONTH, signed, statement, wake, type Said } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const V = (hi: string[], lo: string[]) => Object.fromEntries(["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"].map((v) => [v, hi.includes(v) ? 9_500 : lo.includes(v) ? 500 : 5_000]));
// One owner holds to others' welfare and to what is expected; the other to getting on and getting more.
const KIND = V(["benevolence", "conformity", "universalism"], ["power", "achievement", "stimulation"]);
const HARD = V(["power", "achievement", "stimulation"], ["benevolence", "conformity", "universalism"]);

test("an organisation's character follows its owner's values, about the town's mean; with no owner of the town it is the mean", () => {
  const k = characterOf(KIND), h = characterOf(HARD);
  expect(k.keep).toBeGreaterThan(0); expect(k.standing).toBeGreaterThan(0); expect(k.pay_less).toBeLessThan(0); expect(k.grow).toBeLessThan(0);
  for (const w of Object.keys(k) as (keyof typeof k)[]) expect(h[w]).toBeCloseTo(-k[w], 9);
  expect(Object.values(characterOf(null)).every((x) => x === 0)).toBe(true);
});

// ---------------------------------------------------------------- two shops

const WAGE = 200_000, ASKED = 210_000;
/** A shop with one assistant of two years' standing and money in the bank, asked by them for a rise: what it says. */
function askedForARise(owner: object) {
  const shop = "shop-1";
  const m = retailer.create(context(`${shop}-manager-system`, shop, { premises: shop, workplace: `${shop}/workplace.1`, suppliers: [], demand: 200, wage: WAGE, org: { rise_bps: 5_000 }, ...owner }, { position: `${shop}-manager` }));
  const job = employment("J1", 0, shop, "c1", WAGE);
  const books = { kind: "accounts", accounts: [{ account: `acc-${shop}`, holder: shop, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] };
  const ask = statement("ask-1", 730 * DAY, "variation_request", { author: "c1-self", speaks_for: "c1", addressed_to: [shop], visible_to: ["c1", shop], basis: "J1", text: "Request: a rise.",
    data: { agreement: "J1", about: "J1", would: { who: shop, does: { outcome: { money: { amount: String(ASKED) } } }, every: 14 * DAY } } });
  const w = wake(m, 731 * DAY, { books, mine: { kind: "records", records: [...signed(job), ask] } }, { entity: shop, as: { participant: `${shop}-manager-system`, position: `${shop}-manager` }, more: { readings: { J1: { of: "agreement", status: "in_force" } } } });
  return w.of("statement", "variation_answer").map((c) => ({ to: c.args.to, data: c.args.data, text: c.args.text }));
}

test("two shops alike but for their owners: asked for a rise, one gives it and the other does not; a shop with no wants of its own answers nothing", () => {
  expect(askedForARise({ initiative: true, owner_values: KIND })).toEqual([{ to: ["c1"], data: { about: "J1", granted: true, wage: ASKED }, text: "Granted: your pay is $2,100.00 from the next pay day." }]);
  expect(askedForARise({ initiative: true, owner_values: HARD })).toEqual([{ to: ["c1"], data: { about: "J1", granted: false }, text: "Not granted: your pay stays as it is." }]);
  expect(askedForARise({})).toEqual([]);
  expect(askedForARise({ owner_values: KIND })).toEqual([]); // (the world's dial is off: it takes no initiative)
});

// ---------------------------------------------------------------- two landlords

const ME = "landlord-1", RENT = 150_000;
const lease = (id: string, tenant: string, space: string) => ({ id, at: 0, author: "landlord-1-office-system", record: "agreement", visible_to: [ME, tenant],
  terms: { template: "lease", parties: [ME, tenant], commitments: [{ who: ME, does: { outcome: { occupancy: { who: tenant, in: space } } } }, { who: tenant, does: { outcome: { money: { from: `acc-${tenant}`, to: "acc-landlord", amount: String(RENT), for: "rent" } } }, every: MONTH }] } });
/** A landlord with one home let to ann and one standing empty; it has given ann notice of a rent increase, and she
 * asks it to hold the rent. What it does in the week, and the change to its record that goes with it. */
function letting(owner: object) {
  const m = landlord.create({ participant: "landlord-1-office-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY },
    params: { develop: false, renew: false, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT }, org: { hold_bps: 5_000 }, ...owner } } as any);
  const records = [
    { id: "lot-1", at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "Lot 1.", data: { cells: ["c1", "c2"] } },
    { id: "own-1", at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: "lot-1" }, visible_to: "public" },
    lease("L1", "ann", "s1/home"), ...["landlord-1", "ann"].map((as) => ({ id: `sig-${as}`, at: 0, author: "x", record: "signature", agreement: "L1", as, visible_to: [ME, "ann"] })),
    statement("inc-1", 5 * DAY, "rent_increase", { author: "landlord-1-office-system", speaks_for: ME, addressed_to: ["ann"], visible_to: [ME, "ann"], basis: "L1", data: { lease: "L1", rent: String(RENT + 7_500), from: 70 * DAY, was: String(RENT), last_from: 0 } }),
    statement("ask-1", 6 * DAY, "variation_request", { author: "ann-self", speaks_for: "ann", addressed_to: [ME], visible_to: ["ann", ME], basis: "inc-1", text: "Request: please hold the rent.",
      data: { agreement: "L1", about: "inc-1", would: { who: "ann", does: { outcome: { money: { amount: String(RENT) } } }, every: MONTH } } }),
  ];
  const cells = ["s1", "s2"].map((s, i) => ({ cell: `c${i + 1}`, structure: { structure: s, type: "house", complete: true, spaces: [{ space: `${s}/home`, kind: "dwelling", capacity: 6, count: s === "s1" ? 1 : 0, attrs: { bedrooms: 2 } }] } }));
  let o = { t: 7 * DAY, entity: ME, woke_for: "cadence", outcomes: [], readings: { L1: { of: "agreement", status: "in_force" } }, channels: { mine: { kind: "records", records }, sites: { kind: "sites", cells },
    bank: { kind: "accounts", accounts: [{ account: "acc-landlord", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [{ t: DAY, from: "acc-ann", to: "acc-landlord", amount: String(RENT), currency: "AUD", by: "bank", memo: "rent" }] } } } as unknown as Observation;
  const said: Said[] = [];
  let record: any;
  for (let i = 0; i < 50; i++) {
    const a: any = m.step(o, undefined as any);
    record = a[RECORD] ?? record;
    if (a.type === "wait") break;
    said.push(...callsOf(a, o.t));
    o = { ...o, woke_for: "done", outcomes: [{ action: "call", t: o.t, status: "ok" }], channels: { ...o.channels, mine: { kind: "records", records: [] }, bank: { ...(o.channels as any).bank, transactions: [] } } } as unknown as Observation;
  }
  return { answers: said.filter((c) => c.fn === "statement" && c.args.kind === "variation_answer").map((c) => c.args.data), withdrawn: said.filter((c) => c.fn === "statement" && c.args.withdraw).map((c) => c.args.withdraw),
    listed: said.filter((c) => c.fn === "statement" && c.args.kind === "rental_listing").map((c) => c.args.data.rent), record };
}

test("two landlords alike but for their owners: one holds the rent when asked and lists a vacant home at less; the other refuses and lists it at more; each keeps a record of its own", () => {
  const kind = letting({ initiative: true, owner_values: KIND }), hard = letting({ initiative: true, owner_values: HARD }), plain = letting({});
  expect(kind.answers).toEqual([{ about: "inc-1", granted: true }]);
  expect(kind.withdrawn).toEqual(["inc-1"]);
  expect(hard.answers).toEqual([{ about: "inc-1", granted: false }]);
  expect(hard.withdrawn).toEqual([]);
  // (The asking rent has its own small noise, the same for both: the markup is what differs.)
  expect(kind.listed[0]).toBeLessThan(plain.listed[0]);
  expect(plain.listed[0]).toBeLessThan(hard.listed[0]);
  // A landlord of a town before wants: answers nothing, lists at its routine's markup, and writes no record.
  expect(plain.answers).toEqual([]);
  expect(plain.record).toBeUndefined();
  // The record: its character (about 5,000, the town's mean owner), what it wants, and what happened.
  expect(kind.record.set.character.keep).toBeGreaterThan(5_000);
  expect(hard.record.set.character.keep).toBeLessThan(5_000);
  expect(kind.record.set.memory.recent.map((r: any) => r.what)).toEqual(["held_rent"]);
  expect(hard.record.set.memory.recent.map((r: any) => r.what)).toEqual(["refused_hold"]);
  expect(kind.record.set.circumstances).toEqual({ granted: 1, homes: 2 });
});
