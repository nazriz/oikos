// What a person says of a conduct against what they think (docs/behaviour/culture.md, "What I think and what I say"): the share of the way
// to what the street approves is reputation over reputation plus integrity (Kuran 1995). No model is called.
import { expect, test } from "bun:test";
import { Culture, CULTURE_DEFAULTS, cultureDial, cultureParams, type CultureEnv } from "../src/behaviour/culture";

const dial = (step: object = {}) => cultureDial({ dials: { culture: { conducts: ["complain"], step, profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 8_000 } } } } } })!;
const mk = (o: { belonging?: number; conformity?: number; integrity?: number; draw?: number; step?: object } = {}) => {
  const d = dial(o.step);
  const env: CultureEnv = { z: () => 0, conformity: () => o.conformity ?? 0.5, belonging: () => o.belonging ?? 0.5, integrity: () => o.integrity ?? 0.5, draw: () => o.draw ?? -4 };
  return new Culture(d.params, d, env, { complain: 3_000 });
};

test("pressure is reputation over reputation plus integrity: 0 without care, 1 without integrity, a half where the two weigh alike", () => {
  expect(mk({ belonging: 0 }).pressure()).toBe(0);
  expect(mk({ conformity: 0 }).pressure()).toBe(0);
  expect(mk({ integrity: 0 }).pressure()).toBe(1);
  expect(mk({ belonging: 0, integrity: 0 }).pressure()).toBe(0);
  expect(mk({ belonging: 1, conformity: 1, integrity: 1 }).pressure()).toBe(0.5);
  expect(mk().pressure()).toBeCloseTo(0.25 / 0.75, 10); // the typical person: a third
});

test("it rises with belonging and with conformity and falls with integrity", () => {
  const f = (o: object) => mk(o).pressure();
  expect(f({ belonging: 0.8 })).toBeGreaterThan(f({ belonging: 0.4 }));
  expect(f({ conformity: 0.8 })).toBeGreaterThan(f({ conformity: 0.4 }));
  expect(f({ integrity: 0.8 })).toBeLessThan(f({ integrity: 0.4 }));
});

test("what is said lies between what is thought and what the street approves, and a farther view is moved by more points; nobody saturates at the typical middle", () => {
  for (const draw of [-4, -2, 0]) {
    const r = mk({ draw }).read("complain", 0)!;
    expect(r.says).toBeGreaterThanOrEqual(Math.min(r.own, r.approves));
    expect(r.says).toBeLessThanOrEqual(Math.max(r.own, r.approves));
  }
  const far = mk({ draw: -4 }).read("complain", 0)!, near = mk({ draw: -1 }).read("complain", 0)!;
  expect(far.says - far.own).toBeGreaterThan(near.says - near.own);
  const typical = mk({ draw: -4 }).read("complain", 0)!;
  expect(typical.says).toBeLessThan(typical.approves - 2_000); // a third of the way, not all of it
  const same = mk({ draw: 0, integrity: 0 }).read("complain", 0)!; // with the street's own view, whatever the pressure
  expect(Math.abs(same.says - same.own)).toBeLessThan(1_000);
});

test("the scale is a parameter: doubling it moves the person further, zero says what is thought, and a negative one is refused", () => {
  expect(mk({ step: { reputation_scale_milli: 2_000 } }).pressure()).toBeGreaterThan(mk().pressure());
  expect(mk({ step: { reputation_scale_milli: 0 } }).pressure()).toBe(0);
  expect(CULTURE_DEFAULTS.reputation_scale_milli).toBe(1_000);
  expect(() => cultureParams({ reputation_scale_milli: -1 })).toThrow();
});
