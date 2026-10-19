// Reading's arithmetic (docs/design/ai-citizens.md 13; docs/behaviour/reading.md). No model, no clock, no draw.
// The property that matters most is tested over every reading there can be, not only at the dial's defaults:
// words scale what a decision does and never reverse or outweigh it (Naz, 2026-10-13).

import { expect, test } from "bun:test";
import { drawValues, VALUES } from "../src/shared/mind";
import { combineAskings, LINES, NEUTRAL, POLES, RANGE, readingDial, readingParams, READING_DEFAULTS, wellFormed, type Reading } from "../src/shared/reading";
import { Randomness } from "../src/rng";

const R = new Randomness(11n);
const POP = Object.fromEntries(VALUES.map((v, i) => [v, { mean_bps: 4_000 + 300 * i, sd_bps: 1_500 }])) as any;

/** Every reading a reader can return on the five main lines (answers null or 0..2), appeals all 0. */
const ALL: Reading[] = [];
for (let respect = -2; respect <= 2; respect++) for (let reason = 0; reason <= 2; reason++) for (const answers of [null, 0, 1, 2]) for (let recourse = 0; recourse <= 2; recourse++) for (let threat = 0; threat <= 2; threat++)
  ALL.push({ respect, reason, answers, recourse, threat, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } });








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
