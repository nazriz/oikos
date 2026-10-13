// Reading's arithmetic (docs/design/ai-citizens.md 13; docs/behaviour/reading.md). No model, no clock, no draw.
// The property that matters most is tested over every reading there can be, not only at the dial's defaults:
// words scale what a decision does and never reverse or outweigh it (Naz, 2026-10-13).

import { expect, test } from "bun:test";
import { Inner, innerParams } from "../src/behaviour/inner";
import { drawValues, VALUES } from "../src/behaviour/mind";
import {
  angerAdded, combineAskings, doneToAgency, failedAgency, fearAdded, fit, grantTrust, isNoShift, LINES, NEUTRAL, NO_SHIFT, obeyRate, POLES, publicEffect, RANGE, readingDial, readingParams,
  READING_DEFAULTS, recourseScore, refusalTrust, shiftOf, tieMoved, wellFormed, type Reading, type ReadingParams,
} from "../src/behaviour/reading";
import { Randomness } from "../src/rng";

const R = new Randomness(11n);
const POP = Object.fromEntries(VALUES.map((v, i) => [v, { mean_bps: 4_000 + 300 * i, sd_bps: 1_500 }])) as any;
const person = (k: string, outlook = {}) => {
  const values = drawValues(R.stream(["v", k]), { values: POP });
  return { values, inner: new Inner(R.stream(["i", k]), values, POP, outlook, innerParams({})) };
};

/** Every reading a reader can return on the five main lines (answers null or 0..2), appeals all 0. */
const ALL: Reading[] = [];
for (let respect = -2; respect <= 2; respect++) for (let reason = 0; reason <= 2; reason++) for (const answers of [null, 0, 1, 2]) for (let recourse = 0; recourse <= 2; recourse++) for (let threat = 0; threat <= 2; threat++)
  ALL.push({ respect, reason, answers, recourse, threat, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } });

test("no shift gives today's figures to the digit; a person's record is the same with and without the multiplier at 1", () => {
  const p = READING_DEFAULTS;
  expect(isNoShift(NO_SHIFT)).toBe(true);
  for (const m of [refusalTrust(NO_SHIFT, p), grantTrust(NO_SHIFT, p), failedAgency(NO_SHIFT, p), doneToAgency(NO_SHIFT, p)]) expect(m).toBe(1);
  expect(angerAdded(NO_SHIFT, p) + fearAdded(NO_SHIFT, p) + tieMoved(NO_SHIFT, p) + recourseScore(NO_SHIFT, p)).toBe(0);
  expect(obeyRate(7_300, NO_SHIFT, p)).toBe(7_300);
  expect(publicEffect(NO_SHIFT, "raised", p)).toBeUndefined();
  for (let i = 0; i < 40; i++) {
    const a = person(`s${i}`), b = person(`s${i}`);
    const good = i % 2 === 0;
    const ea = a.inner.experience("office", "gov", good, 0, { weight: 2 }), eb = b.inner.experience("office", "gov", good, 0, { weight: 2, scale: 1 });
    expect(eb.after).toBe(ea.after);
    expect(eb.plain).toBe(eb.after);
    a.inner.tried(good, 1); b.inner.tried(good, 1, 1);
    a.inner.doneTo(0.5); b.inner.doneTo(0.5, 1);
    expect(b.inner.sections()).toEqual(a.inner.sections());
  }
});

/** Every distinct shift there can be between two readings (the multipliers depend on the shift alone). */
const SHIFTS = (() => {
  const seen = new Map<string, ReturnType<typeof shiftOf>>();
  for (const r of ALL) for (const plain of ALL) { const s = shiftOf(r, plain); seen.set(JSON.stringify([s.respect, s.reason, s.answers, s.recourse, s.threat]), s); }
  return [...seen.values()];
})();

test("every multiplier stays within its bounds, for every reading against every plain paper", () => {
  const p = READING_DEFAULTS;
  expect(SHIFTS.length).toBeGreaterThan(500);
  for (const s of SHIFTS) {
    expect(refusalTrust(s, p)).toBeGreaterThanOrEqual(0.4); expect(refusalTrust(s, p)).toBeLessThanOrEqual(1.6);
    expect(grantTrust(s, p)).toBeGreaterThanOrEqual(0.8); expect(grantTrust(s, p)).toBeLessThanOrEqual(1.2);
    expect(failedAgency(s, p)).toBeGreaterThanOrEqual(0.5); expect(failedAgency(s, p)).toBeLessThanOrEqual(1.25);
    expect(doneToAgency(s, p)).toBeGreaterThanOrEqual(0.6); expect(doneToAgency(s, p)).toBeLessThanOrEqual(1.2);
    const o = obeyRate(5_000, s, p);
    expect(o).toBeGreaterThanOrEqual(5_000 * 0.85 - 1); expect(o).toBeLessThanOrEqual(5_000 * 1.15 + 1);
  }
});

/** Settings a world could give that readingParams accepts: the extremes of what is allowed, and a spread between. */
const settings = (): ReadingParams[] => {
  const out: ReadingParams[] = [READING_DEFAULTS];
  for (const floor of [100, 400, 1_000]) for (const ceil of [1_000, 1_600, 2_000]) {
    out.push(readingParams({
      refusal: { floor_milli: floor, ceil_milli: ceil, respect_bps: 10_000, reason_bps: 10_000, answers_bps: 10_000 }, grant: { floor_milli: floor, ceil_milli: ceil, respect_bps: 10_000 },
      failed: { floor_milli: floor, ceil_milli: ceil, answers_bps: 10_000, recourse_bps: 10_000 }, done_to: { floor_milli: floor, ceil_milli: ceil, reason_bps: 10_000, recourse_bps: 10_000 },
    }));
  }
  return out;
};

test("kind words soften and never outweigh: whatever the reading, a refusal still costs, a grant still counts, and the words' part is within the decision's own", () => {
  for (const p of settings()) {
    // The most trust a person can lose or gain in one decision at the placeholder sizes: the words' part is a multiple
    // of the plain figure with a multiplier in [floor, ceil], so it is at most (ceil - 1) of the decision, ceil <= 2.
    const refuse = (scale: number) => { const x = person("k"); return x.inner.experience("office", "gov", false, 0, { weight: 1, scale }); };
    const grant = (scale: number) => { const x = person("k"); return x.inner.experience("office", "gov", true, 0, { weight: 1, scale }); };
    const tried = (scale: number) => { const x = person("k"); return x.inner.tried(false, 1, scale); };
    const doneTo = (scale: number) => { const x = person("k"); return x.inner.doneTo(1, scale); };
    const memo = <T,>(f: (x: number) => T) => { const m = new Map<number, T>(); return (x: number) => m.get(x) ?? (m.set(x, f(x)), m.get(x)!); };
    const [refuseM, grantM, triedM, doneToM] = [memo(refuse), memo(grant), memo(tried), memo(doneTo)];
    for (const s of SHIFTS) {
      const rf = refuseM(refusalTrust(s, p)), gr = grantM(grantTrust(s, p)), tr = triedM(failedAgency(s, p)), dt = doneToM(doneToAgency(s, p));
      // Never reversed: a refusal never leaves trust higher than it was, a grant never lower; likewise agency.
      expect(rf.after).toBeLessThanOrEqual(rf.before); expect(gr.after).toBeGreaterThanOrEqual(gr.before);
      expect(tr.after).toBeLessThanOrEqual(tr.before); expect(dt.after).toBeLessThanOrEqual(dt.before);
      // Never outweighed: how the paper is put moves the figure by no more than what the decision itself moves it.
      expect(Math.abs(rf.after - rf.plain)).toBeLessThanOrEqual(rf.before - rf.plain + 1);
      expect(Math.abs(gr.after - gr.plain)).toBeLessThanOrEqual(gr.plain - gr.before + 1);
      expect(Math.abs(tr.after - tr.plain)).toBeLessThanOrEqual(tr.before - tr.plain + 1);
      expect(Math.abs(dt.after - dt.plain)).toBeLessThanOrEqual(dt.before - dt.plain + 1);
    }
  }
});

test("a setting that would let words reverse or outweigh a decision is refused", () => {
  expect(() => readingParams({ refusal: { floor_milli: 0 } })).toThrow(/never reverse or outweigh/);
  expect(() => readingParams({ refusal: { ceil_milli: 2_500 } })).toThrow(/never reverse or outweigh/);
  expect(() => readingParams({ grant: { floor_milli: 1_200 } })).toThrow(/never reverse or outweigh/);
  expect(() => readingParams({ done_to: { ceil_milli: 900 } })).toThrow(/never reverse or outweigh/);
  expect(() => readingParams({ obey_max_bps: 6_000 })).toThrow(/at most half/);
  expect(() => readingParams({ public: { weight_raised_bps: 9_000 } })).toThrow(/at most half/);
  expect(() => readingParams({ tie_bps: -5 })).toThrow(/whole number/);
  expect(readingParams({}).refusal.floor_milli).toBe(400);
});

test("the worked example of 13b: a refusal put two ways, to the figure", () => {
  // Trust 5,200; plain refusal reads respect 0, reason 1, answers 1, recourse 0, threat 0.
  const plain: Reading = { respect: 0, reason: 1, answers: 1, recourse: 0, threat: 0, appeals: NEUTRAL.appeals };
  const humane: Reading = { respect: 1, reason: 2, answers: 2, recourse: 2, threat: 0, appeals: NEUTRAL.appeals };
  const curt: Reading = { respect: -2, reason: 0, answers: 0, recourse: 0, threat: 0, appeals: NEUTRAL.appeals };
  const p = READING_DEFAULTS;
  expect(shiftOf(humane, plain)).toMatchObject({ respect: 1, reason: 1, answers: 1, recourse: 2, threat: 0 });
  expect(refusalTrust(shiftOf(humane, plain), p)).toBeCloseTo(0.55, 10);
  expect(refusalTrust(shiftOf(curt, plain), p)).toBe(1.6); // 1.65, held
  expect(failedAgency(shiftOf(humane, plain), p)).toBeCloseTo(0.65, 10);
  expect(failedAgency(shiftOf(curt, plain), p)).toBeCloseTo(1.15, 10);
  expect(angerAdded(shiftOf(curt, plain), p)).toBe(2_000);
  expect(tieMoved(shiftOf(curt, plain), p)).toBe(-1_000);
  expect(recourseScore(shiftOf(humane, plain), p)).toBe(1_000);
  // (The agency figures to within 2: the person's own level is drawn around 4,300 and cannot be set exactly.)
  // And on a record that holds trust at 5,200 and agency at 4,300.
  const trustAt = (shift: Reading) => {
    const x = person("w");
    // Put the person's trust at 5,200 by their own start: use experience on an institution whose start we set.
    const inner = new Inner(R.stream(["w"]), x.values, POP, { trust: { gov: 5_200 }, agency: { mean_bps: 4_300, sd_bps: 1 } }, innerParams({ trust: { spread_bps: 0, values_bps: 0, bad_bps: 600 } }));
    const e = inner.experience("office", "gov", false, 0, { scale: refusalTrust(shiftOf(shift, plain), p) });
    const a = inner.tried(false, 1, failedAgency(shiftOf(shift, plain), p));
    return { e, a };
  };
  expect(trustAt(plain).e.after).toBe(4_888);
  expect(trustAt(humane).e.after).toBe(5_028);
  expect(trustAt(curt).e.after).toBe(4_701);
  expect(Math.abs(trustAt(plain).a.after - 4171)).toBeLessThanOrEqual(2);
  expect(Math.abs(trustAt(humane).a.after - 4216)).toBeLessThanOrEqual(2);
  expect(Math.abs(trustAt(curt).a.after - 4152)).toBeLessThanOrEqual(2);
});

test("a public paper's effect is the stated weight (worked example 2) and never more than half a decision's", () => {
  const p = READING_DEFAULTS;
  const plain: Reading = { respect: 0, reason: 1, answers: 1, recourse: 0, threat: 0, appeals: NEUTRAL.appeals };
  const kind: Reading = { respect: 1, reason: 2, answers: 2, recourse: 1, threat: 0, appeals: NEUTRAL.appeals };
  const e = publicEffect(shiftOf(kind, plain), "raised", p)!;
  expect(e.good).toBe(true);
  expect(e.weight).toBeCloseTo(0.5, 10);
  const brush: Reading = { respect: -1, reason: 0, answers: 0, recourse: 0, threat: 0, appeals: NEUTRAL.appeals };
  expect(publicEffect(shiftOf(brush, plain), "raised", p)!.good).toBe(false);
  for (const r of ALL) for (const q of ALL.filter((_, i) => i % 17 === 0)) for (const st of ["raised", "affected", "public"] as const) {
    const x = publicEffect(shiftOf(r, q), st, p);
    if (x) expect(x.weight).toBeLessThanOrEqual(0.5);
  }
});

test("the fit sums to about nothing over a drawn town, and a paper gains some and loses others", () => {
  const n = 3_000;
  const town = Array.from({ length: n }, (_, i) => drawValues(R.stream(["town", String(i)]), { values: POP }));
  const z = (vals: any) => (v: (typeof VALUES)[number]) => (vals[v] - POP[v].mean_bps) / POP[v].sd_bps;
  for (const appeals of [{ openness: 0, conservation: 2, enhancement: 0, transcendence: 1 }, { openness: 2, conservation: 0, enhancement: 2, transcendence: 0 }, { openness: 1, conservation: 1, enhancement: 1, transcendence: 1 }]) {
    const fits = town.map((v) => fit(appeals, z(v)));
    const m = fits.reduce((a, b) => a + b, 0) / n;
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(fits.some((f) => f > 0.1)).toBe(true);
    expect(fits.some((f) => f < -0.1)).toBe(true);
    for (const f of fits) { expect(f).toBeGreaterThanOrEqual(-1); expect(f).toBeLessThanOrEqual(1); }
  }
  // The worked example: conservation 1.2 above the town, transcendence 0.3 above: (2 x 1.2 + 1 x 0.3) / 4 = 0.675.
  const zs: any = { security: 1.2, conformity: 1.2, tradition: 1.2, universalism: 0.3, benevolence: 0.3, self_direction: 0, stimulation: 0, hedonism: 0, achievement: 0, power: 0 };
  expect(fit({ openness: 0, conservation: 2, enhancement: 0, transcendence: 1 }, (v) => zs[v])).toBeCloseTo(0.675, 10);
});

test("two askings: the mean toward 0, and a line a step apart is the plain paper's and counted", () => {
  const mk = (respect: number, reason: number, answers: number | null): Reading => ({ respect, reason, answers, recourse: 0, threat: 0, appeals: NEUTRAL.appeals });
  const plain = mk(0, 1, 1);
  const r = combineAskings(mk(1, 2, 2), mk(2, 0, 2), plain);
  expect(r.reading.respect).toBe(1); // (1+2)/2 = 1.5 toward 0
  expect(r.reading.reason).toBe(1); // 2 and 0 are two apart: plain's
  expect(r.reading.answers).toBe(2);
  expect(r.apart).toEqual(["reason"]);
  expect(combineAskings(mk(-1, 0, null), mk(-2, 0, null), plain).reading.respect).toBe(-1);
  expect(combineAskings(mk(0, 0, null), mk(0, 0, 1), plain).apart).toEqual(["answers"]);
  expect(wellFormed(r.reading)).toBe(true);
  expect(wellFormed({ ...r.reading, respect: 3 })).toBe(false);
  expect(wellFormed({ ...r.reading, reason: 0.5 })).toBe(false);
  expect(LINES.length).toBe(9);
  expect(RANGE.respect).toEqual([-2, 2]);
  expect(POLES.length).toBe(4);
});

test("the dial: absent is off; present is read with its sizes over the defaults", () => {
  expect(readingDial(undefined)).toBeUndefined();
  expect(readingDial({})).toBeUndefined();
  expect(readingDial({ dials: { initiative_bps: 10_000 } })).toBeUndefined();
  const d = readingDial({ dials: { reading: { reader: "mock" } } })!;
  expect(d.papers).toEqual(["decision"]);
  expect(d.calls_per_run).toBe(800);
  expect(d.params).toEqual(READING_DEFAULTS);
  expect(readingDial({ dials: { reading: { reader: "mock", step: { tie_bps: 100 } } } })!.params.tie_bps).toBe(100);
  expect(() => readingDial({ dials: { reading: { reader: "mock", step: { refusal: { floor_milli: 0 } } } } })).toThrow();
});
