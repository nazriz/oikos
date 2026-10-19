// The richer record's arithmetic (docs/design/ai-citizens.md 10c, 10d; docs/behaviour/citizen.md "The record"): trust,
// agency, what is thought and what is said, values that drift and are shocked, upbringing, bounded ties and memory.
// No model, no clock; every draw from a stream handed in.

import { expect, test } from "bun:test";
import { raisedValues, UPBRINGING } from "../src/shared/inner";
import { drawValues, VALUES } from "../src/shared/mind";
import { Randomness } from "../src/rng";

const DAY = 86_400;
const R = new Randomness(7n);
const rng = (k: string) => R.stream(["test", k]);
const POP = Object.fromEntries(VALUES.map((v, i) => [v, { mean_bps: 4_000 + 300 * i, sd_bps: 1_500 }])) as any;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const corr = (a: number[], b: number[]) => mean(a.map((x, i) => (x - mean(a)) * (b[i]! - mean(b)))) / (sd(a) * sd(b));








test("a child's values come from those who raise them and a part of their own, and the town's spread of values is unchanged", () => {
  const parents = Array.from({ length: 1_500 }, (_, i) => [drawValues(rng(`pa-${i}`), { values: POP }), drawValues(rng(`pb-${i}`), { values: POP })]);
  const kids = parents.map((ps, i) => raisedValues(rng(`kid-${i}`), POP, ps, UPBRINGING.share_bps));
  const lone = parents.map((ps, i) => raisedValues(rng(`lone-${i}`), POP, [ps[0]!], UPBRINGING.share_bps));
  for (const v of ["security", "universalism"] as const) {
    const mid = parents.map((ps) => (ps[0]![v] + ps[1]![v]) / 2);
    expect(corr(mid, kids.map((k) => k[v]))).toBeGreaterThan(0.25);
    expect(corr(parents.map((ps) => ps[0]![v]), lone.map((k) => k[v]))).toBeGreaterThan(0.4);
    for (const group of [kids, lone]) {
      expect(Math.abs(sd(group.map((k) => k[v])) - POP[v].sd_bps)).toBeLessThan(120);
      expect(Math.abs(mean(group.map((k) => k[v])) - POP[v].mean_bps)).toBeLessThan(120);
    }
  }
  // Nobody to raise them: a draw from the town's figures.
  const alone = Array.from({ length: 800 }, (_, i) => raisedValues(rng(`al-${i}`), POP, [], UPBRINGING.share_bps));
  expect(Math.abs(sd(alone.map((k) => k.security)) - POP.security.sd_bps)).toBeLessThan(150);
});




