// The term at a decision (docs/behaviour/culture.md; design 14d): one bounded term, at the draw the conduct already has, in the
// right direction; the same draw meets a shifted rate; with the dial off, the decision is the one it was. No model.

import { expect, test } from "bun:test";


import { OUTCOMES } from "../src/module";
import { DAY, employment, lease, person, signed, standingOrder, statement } from "./stepping";
import { engine } from "./engine";
import { CULTURE_WORDS } from "./phrasing";
const citizen = engine("citizen.default");

const HOME = "apts-1/dwelling.1", WAGE = 120_000, RENT = 100_000;
const tenancy = () => [...signed(lease("L1", 0, "landlord-1", "c1", HOME, RENT)), standingOrder("so-1", 0, "c1", "acc-landlord-1", RENT, { basis: "L1", first: 0 }), ...signed(employment("J1", 0, "factory-1", "c1", WAGE))];
const READ = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
const wages = (t: number) => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c1", amount: String(WAGE), currency: "AUD", by: "bank", memo: "wages" }];
const notice = (at: number) => statement("ntv-1", at, "notice_to_vacate", { author: "landlord-1-office-system", speaks_for: "landlord-1", addressed_to: ["c1"], visible_to: ["landlord-1", "c1"], data: { lease: "L1", by: at + 28 * DAY, arrears: "200000", given: at } });
const from = (text: string, id: string) => ({ id, from: "c9-self", t: 0, text });
// Everything the person values is middling, but conformity and tradition: the least conformist and the most.
const values = (hi: number) => ({ self_direction: 5_000, stimulation: 5_000, hedonism: 5_000, achievement: 5_000, power: 5_000, security: 5_000, conformity: hi, tradition: hi, benevolence: 5_000, universalism: 5_000 });
const BASE = { own_values: values(9_000), possession: { stay_bps: 5_000, obey_bps: 5_000 } };
const DIALS = { culture: {} };

/** The share, over many people (seeds), who stay past a notice to vacate, given what was told to each before it came. */
async function staying(o: { dials?: object; told?: { text: string; n: number }; params?: object }) {
  let stays = 0, norm = 0;
  const N = 150;
  for (let seed = 1n; seed <= BigInt(N); seed++) {
    const outcomes: any[] = [];
    const module = { create: (ctx: any) => { const m = citizen.create(ctx); return { step: async (ob: any, c: any) => { const a: any = await m.step(ob, c); outcomes.push(...(a[OUTCOMES] ?? [])); return a; } }; } };
    const p = person(module, { ...BASE, ...(o.params ?? {}) }, { seed, ...(o.dials ? { dials: o.dials } : {}) });
    await p.wake(DAY, { records: tenancy(), readings: READ, balance: 5_000_000, transactions: wages(DAY) });
    if (o.told) for (let i = 0; i < o.told.n; i++) await p.wake(2 * DAY + i * 3_600, { inbox: [from(o.told.text, `m${i}`)] , transactions: wages(2 * DAY) });
    await p.wake(10 * DAY, { records: [notice(10 * DAY)], transactions: wages(10 * DAY) });
    const out = outcomes.find((x) => x.kind === "notice_to_vacate");
    if (out?.facts.stays) stays++;
    if (out?.facts.norm_lean !== undefined) norm++;
  }
  return { share: stays / N, norm };
}
const STAYED = CULTURE_WORDS.did("stay_past_notice", true), LEFT = CULTURE_WORDS.did("stay_past_notice", false);

test("a conformist who is told that those they know stay past a notice stays more often; told that they leave, less; bounded either way; the dial off is the draw it was", async () => {
  const off = await staying({});
  const neutral = await staying({ dials: DIALS });
  const high = await staying({ dials: DIALS, told: { text: STAYED, n: 20 } });
  const low = await staying({ dials: DIALS, told: { text: LEFT, n: 20 } });
  // The right way.
  expect(high.share).toBeGreaterThan(neutral.share + 0.05);
  expect(low.share).toBeLessThan(neutral.share - 0.05);
  // Bounded: one term of at most three standard deviations at the sway: a rate of 5,000 cannot leave 5,000 * (1 +/- 0.9).
  expect(high.share).toBeLessThanOrEqual(0.5 * 1.9 + 0.12);
  expect(low.share).toBeGreaterThanOrEqual(0.5 * 0.1 - 0.05);
  // The decision records the numbers and the lean (hundredths of a deviation); with the dial off it records nothing of the kind.
  expect(neutral.norm).toBeGreaterThan(100);
  expect(off.norm).toBe(0);
  // Without any picture moved, people differ by their own lean alone and the calibrated rate holds on average (the lean sums to nothing).
  expect(Math.abs(neutral.share - 0.5)).toBeLessThan(0.1);
  expect(Math.abs(off.share - 0.5)).toBeLessThan(0.1);
}, 120_000);

test("someone who is not a conformist follows themself: the same telling moves them less", async () => {
  const conformist = await staying({ dials: DIALS, told: { text: STAYED, n: 20 } });
  const neutralC = await staying({ dials: DIALS });
  const loner = await staying({ dials: DIALS, told: { text: STAYED, n: 20 }, params: { own_values: values(1_000) } });
  const neutralL = await staying({ dials: DIALS, params: { own_values: values(1_000) } });
  expect(conformist.share - neutralC.share).toBeGreaterThan(loner.share - neutralL.share);
}, 120_000);
