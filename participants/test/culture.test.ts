// Culture (docs/behaviour/culture.md; design 14): the numbers a person holds of what those around them do and approve of.
// Arithmetic only: no model, no clock, no draw but a starting lean on the person's own stream.

import { expect, test } from "bun:test";
import { citizen } from "../src/behaviour/citizen";
import { CONDUCTS, Culture, CULTURE_DEFAULTS, cultureDial, cultureParams, normsRows, standardNormal, type CultureEnv, type Conduct, type NormsSection } from "../src/behaviour/culture";
import { VALUES } from "../src/behaviour/mind";
import { Randomness } from "../src/rng";
import { RECORD } from "../src/module";
import { DAY, person } from "./stepping";

const dialOf = (more: object = {}) => cultureDial({ dials: { culture: { ...more } } })!;
const RATES: { [c in Conduct]?: number } = { answer_tribunal: 6_000, stay_past_notice: 2_000, take_to_tribunal: 1_500, complain: 3_000, take_in: 5_000, join_union: 3_500, strike: 8_500, take_from_employer: 300 };

/** A person from a seed: values and conformity drawn as a town's are (z around 0), belonging and integrity in 0..1. */
function someone(i: number, o: { group?: string; dial?: ReturnType<typeof dialOf>; rates?: typeof RATES } = {}) {
  const r = new Randomness(7n).stream([`p${i}`, "x"]);
  const zs = Object.fromEntries(VALUES.map((v) => [v, standardNormal(r)]));
  const k = Math.min(1, Math.max(0, 0.5 + 0.15 * standardNormal(r)));
  const env: CultureEnv = { z: (v) => Math.max(-3, Math.min(3, zs[v]!)), conformity: () => k, belonging: () => 0.5, integrity: () => 0.5, draw: (c) => standardNormal(new Randomness(7n).stream([`p${i}`, `culture-own-${c}`])) };
  const dial = o.dial ?? dialOf();
  return new Culture(dial.params, dial, env, o.rates ?? RATES, o.group, 0);
}

test("the sizes are checked: a size that would break the arithmetic is refused", () => {
  expect(cultureParams()).toEqual(CULTURE_DEFAULTS);
  expect(() => cultureParams({ window: 2 })).toThrow(/window/);
  expect(() => cultureParams({ sway_milli: 1_500 })).toThrow(/sway_milli/);
  expect(() => cultureParams({ close_weight: 0 })).toThrow(/at least 1/);
  expect(() => cultureParams({ own_sd_bps: 12_000 })).toThrow(/share/);
  expect(() => cultureDial({ dials: { culture: { conducts: ["be_good"] } } })).toThrow(/not a conduct/);
  expect(cultureDial({}) ).toBeUndefined();
  expect(cultureDial({ dials: { initiative_bps: 10_000 } })).toBeUndefined();
});

test("a person starts with the profile's picture (the conduct's own rate where it gives none), and their own lean from their values", () => {
  const dial = dialOf({ profile: { conducts: { complain: { does_bps: 2_000, approves_bps: 7_000 } } } });
  const c = someone(1, { dial });
  expect(c.held).toContain("complain");
  const r = c.read("complain", 0)!;
  expect(r.does).toBe(2_000);
  expect(r.approves).toBe(7_000);
  expect(r.n).toBe(CULTURE_DEFAULTS.prior_weight);
  // No figure for approval: the named placeholder; no figure for what is done: the world's own rate.
  const s = someone(1).read("answer_tribunal", 0)!;
  expect(s.does).toBe(6_000);
  expect(s.approves).toBe(CULTURE_DEFAULTS.approves_default_bps);
  // The three organisation conducts are held only where the profile gives a figure.
  expect(someone(1).has("apply_possession")).toBe(false);
  expect(someone(1, { dial: dialOf({ profile: { conducts: { apply_possession: { does_bps: 6_000 } } } }) }).has("apply_possession")).toBe(true);
});

test("with every figure at the profile's, the lean at a decision sums to nothing over a drawn town: the calibrated rates hold on day 1", () => {
  const N = 3_000;
  const town = Array.from({ length: N }, (_, i) => someone(i)); // (drawn once: the same people for every conduct)
  for (const conduct of CONDUCTS.slice(0, 8)) {
    let sum = 0, sq = 0;
    for (const p of town) { const l = p.lean(conduct, 0); sum += l; sq += l * l; }
    expect(Math.abs(sum / N), conduct).toBeLessThan(0.05);
    expect(Math.sqrt(sq / N), conduct).toBeGreaterThan(0.1); // (people differ: it is not zero for each)
    expect(Math.sqrt(sq / N), conduct).toBeLessThan(1.5);
  }
}, 60_000); // (3.5 s alone; the 5 s default timed out under a loaded full suite)

test("a rate is swayed by the lean and held: bounded, the right way, and a person with no lean leaves it where it is", () => {
  const c = someone(3);
  for (const conduct of CONDUCTS.slice(0, 8)) {
    const lean = c.lean(conduct, 0);
    expect(Math.abs(lean)).toBeLessThanOrEqual(3);
    const up = c.term(4_000, conduct, 0), down = c.term(4_000, conduct, 0, -1);
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThanOrEqual(10_000);
    if (lean > 0) { expect(up).toBeGreaterThanOrEqual(4_000); expect(down).toBeLessThanOrEqual(4_000); }
    if (lean < 0) { expect(up).toBeLessThanOrEqual(4_000); expect(down).toBeGreaterThanOrEqual(4_000); }
  }
});

test("the record's section holds at most 12 rows of whole percent, under 750 bytes, whatever has been seen", () => {
  const dial = dialOf({ profile: { conducts: Object.fromEntries(CONDUCTS.map((c) => [c, { does_bps: 4_000, approves_bps: 6_000 }])) } });
  const c = someone(5, { dial });
  expect(c.held.length).toBe(CONDUCTS.length);
  expect(CONDUCTS.length).toBeLessThanOrEqual(12);
  const at = (t: number) => JSON.stringify(c.section(t));
  const before = at(0).length;
  // A thousand sightings and ten years change figures and never the size.
  for (let i = 0; i < 1_000; i++) for (const k of CONDUCTS) { c.seeAct(k, i % 3 === 0, "tie"); c.hearSaid(k, 9_999, "published"); }
  const after = at(3_650 * DAY);
  expect(after.length).toBeLessThan(750);
  expect(Math.abs(after.length - before)).toBeLessThan(150);
  for (const row of normsRows(c.section(0))) row.numbers.slice(0, 4).forEach((x) => { expect(Number.isInteger(x)).toBe(true); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); });
});

test("what is thought settles toward what is approved, worked out when read, by half in the days the dial sets", () => {
  const c = someone(9);
  const a0 = c.read("complain", 0)!;
  const half = CULTURE_DEFAULTS.internalise_days * DAY;
  const a1 = c.read("complain", half)!;
  const gap0 = a0.own - a0.approves, gap1 = a1.own - a1.approves;
  expect(Math.abs(gap1 - gap0 / 2)).toBeLessThanOrEqual(2); // (rounding to basis points, twice)
});

/** A townsperson whose record changes are kept as they go to the orchestrator. */
function watched(params: object, dials?: object) {
  const kept = { record: {} as { [section: string]: any } };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); return a; } };
  } };
  return { p: person(module, params, { dials }), kept };
}

test("a person of this dial writes a norms section into their record; with the dial off, none", async () => {
  const dials = { culture: { profile: { conducts: { complain: { does_bps: 2_500, approves_bps: 6_500 } } } } };
  const params = { complain_to: "town", complain_bps: 3_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, tribunal: { entity: "tribunal", challenge_bps: 1_500, apply_bps: 800, apply_after_days: 30 }, origin: "north" };
  const on = watched(params, dials), off = watched(params);
  await on.p.wake(DAY);
  await off.p.wake(DAY);
  expect(off.kept.record.norms).toBeUndefined();
  const norms = normsRows(on.kept.record.norms as NormsSection);
  expect(norms.map((x) => x.conduct)).toEqual(["answer_tribunal", "stay_past_notice", "take_to_tribunal", "complain", "take_in", "apply_possession"]);
  const complain = norms.find((x) => x.conduct === "complain")!;
  expect(complain.numbers.slice(0, 2)).toEqual([25, 65]);
  // Nothing else of the record is different.
  const { norms: _n, ...rest } = on.kept.record;
  expect(rest).toEqual(off.kept.record);
});

// Step 0: a section that has not moved costs nothing to carry. The kernel canonicalises and hashes a person's whole record at every change,
// so what a section costs is its bytes, each time anything in the record is written; and it is not written again unless a figure has moved.
test("the norms section is positional and small, and a record whose pictures have not moved is not given it again", async () => {
  const c = someone(3);
  const sec = c.section(0);
  expect(sec.length).toBeLessThanOrEqual(12);
  expect(JSON.stringify(sec).length).toBeLessThan(200); // (named rows were about 400 bytes for the same eight conducts)
  expect(normsRows(sec).map((r) => r.conduct)).toEqual(c.held);
  // Asked again with nothing moved: the very same array (not worked out again, not compared again).
  expect(c.section(5 * DAY)).toBe(sec);
  const dials = { culture: { profile: { conducts: { complain: { does_bps: 2_500, approves_bps: 6_500 } } } } };
  const params = { complain_to: "town", complain_bps: 3_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, origin: "north" };
  let sets = 0;
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, cx: any) => { const a: any = await m.step(o, cx); if (a[RECORD]?.set?.norms) sets++; return a; } };
  } };
  const p = person(module, params, { dials });
  for (let d = 1; d <= 20; d++) await p.wake(d * DAY);
  expect(sets).toBe(1); // written once, at the start; twenty days of nothing told or seen add no write
});
