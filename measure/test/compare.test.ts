// Comparing arms (measure/src/compare.ts) and pre-registration (measure/src/prereg.ts): Student's t against its table,
// paired differences and the difference in differences seed by seed, the interval, Bonferroni; a registration checked
// in itself and against the spec it is of.

import { expect, test } from "bun:test";
import { bonferroni, differenceInDifferences, interval, pairedDifferences, tCdf, tQuantile } from "../src/compare";
import { comparisonKey, parsePrereg, preregHash, preregProblems, specMismatch, type Preregistration } from "../src/prereg";

test("Student's t quantiles match the printed table", () => {
  // (Two-sided 95%: 12.706 at 1 df, 4.303 at 2, 2.776 at 4, 2.228 at 10, 1.960 in the limit; 99%: 9.925 at 2.)
  for (const [df, t] of [[1, 12.706], [2, 4.303], [4, 2.776], [10, 2.228], [1000, 1.962]] as const) expect(tQuantile(0.975, df)).toBeCloseTo(t, 2);
  expect(tQuantile(0.995, 2)).toBeCloseTo(9.925, 2);
  expect(tCdf(0, 5)).toBeCloseTo(0.5, 10);
  expect(tQuantile(0.025, 4)).toBeCloseTo(-2.776, 2);
});

test("differences are taken seed by seed, and only where both arms have a value", () => {
  const a = [{ seed: 1, value: 10 }, { seed: 2, value: 12 }, { seed: 3, value: null }, { seed: 4, value: 7 }];
  const b = [{ seed: 1, value: 4 }, { seed: 2, value: 5 }, { seed: 3, value: 1 }];
  expect(pairedDifferences(a, b)).toEqual([{ seed: 1, value: 6 }, { seed: 2, value: 7 }]);
  const c = [{ seed: 1, value: 3 }, { seed: 2, value: 3 }], d = [{ seed: 1, value: 1 }, { seed: 2, value: 2 }];
  // (10-4) - (3-1) = 4; (12-5) - (3-2) = 6
  expect(differenceInDifferences(a, b, c, d)).toEqual([{ seed: 1, value: 4 }, { seed: 2, value: 6 }]);
});

test("the interval is the mean plus or minus t times the standard error; one seed has none", () => {
  const iv = interval([{ seed: 1, value: 1 }, { seed: 2, value: 2 }, { seed: 3, value: 3 }]);
  expect([iv.n, iv.mean, iv.sd]).toEqual([3, 2, 1]);
  expect(iv.lo!).toBeCloseTo(2 - 4.303 / Math.sqrt(3), 3);
  expect(iv.hi!).toBeCloseTo(2 + 4.303 / Math.sqrt(3), 3);
  expect([iv.above, iv.below, iv.zero]).toEqual([3, 0, 0]);
  const one = interval([{ seed: 1, value: 5 }]);
  expect([one.mean, one.lo, one.hi]).toEqual([5, null, null]);
  expect(interval([]).mean).toBeNull();
  // the same differences in every seed: no spread, an interval of a point
  expect(interval([{ seed: 1, value: 0 }, { seed: 2, value: 0 }])).toMatchObject({ lo: 0, hi: 0, zero: 2 });
});

test("Bonferroni reads each of k comparisons at 1 - (1 - level) / k", () => {
  expect(bonferroni(0.95, 1)).toBe(0.95);
  expect(bonferroni(0.95, 5)).toBeCloseTo(0.99, 10);
});

const prereg = (over: Partial<Preregistration> = {}): Preregistration => ({
  preregistration: 1, experiment: "e", registered: "2026-10-23", question: "q", post: "p", arms: ["code", "a", "b"], reference: "code",
  seeds: [1, 2, 3], forkDay: 30, untilDay: 180, primary: [{ measure: "m1", arm: "a", vs: "code", expect: "lower" }], ...over,
});
const known = (m: string) => ["m1", "m2"].includes(m);

test("a registration names its question, arms, seeds, days and at least one primary comparison of a measure that exists", () => {
  expect(preregProblems(prereg(), known)).toEqual([]);
  expect(preregProblems(prereg({ primary: [] }), known)).toContain("no primary comparison: a registration names at least one");
  expect(preregProblems(prereg({ primary: [{ measure: "goodness", arm: "a" }] }), known)).toContain('primary: no measure "goodness"');
  expect(preregProblems(prereg({ primary: [{ measure: "m1", arm: "z" }] }), known)).toContain("primary: m1: z is not an arm");
  expect(preregProblems(prereg({ secondary: [{ measure: "m1", arm: "a", vs: "code" }] }), known)).toContain("secondary: m1: a - code is registered twice");
  expect(preregProblems(prereg({ primary: [{ measure: "m2", did: ["a", "code", "b", "code"] }] }), known)).toEqual([]);
  expect(preregProblems(prereg({ forkDay: 200 }), known)).toContain("forkDay must come before untilDay");
  expect(preregProblems(prereg({ reference: "x" }), known)).toContain("the reference x is not an arm");
  expect(comparisonKey({ measure: "m1", arm: "a" }, "code")).toBe("m1: a - code");
});

test("a spec that differs from its registration is named in every way it differs", () => {
  const spec = { name: "e", post: "p", seeds: [3, 2, 1], forkDay: 30, untilDay: 180, arms: [{ name: "code" }, { name: "b" }, { name: "a" }], reference: "code" };
  expect(specMismatch(prereg(), spec)).toEqual([]);
  const off = specMismatch(prereg(), { ...spec, seeds: [1, 2], untilDay: 200, arms: [{ name: "code" }, { name: "a" }] });
  expect(off).toHaveLength(3);
  expect(off.join(" ")).toMatch(/seeds.*days.*arms/);
});

test("a registration reads from JSON or YAML, and its hash is of its text as filed", () => {
  const yaml = "preregistration: 1\nexperiment: e\nregistered: '2026-10-23'\nquestion: q\npost: p\narms: [code, a]\nreference: code\nseeds: [1]\nforkDay: 1\nuntilDay: 2\nprimary:\n  - { measure: m1, arm: a }\n";
  expect(parsePrereg(yaml, "x.yaml")).toMatchObject({ experiment: "e", primary: [{ measure: "m1", arm: "a" }] });
  expect(parsePrereg(JSON.stringify(prereg()), "x.json").arms).toEqual(["code", "a", "b"]);
  expect(preregHash("a")).not.toBe(preregHash("a "));
});
