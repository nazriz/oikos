import { expect, test } from "bun:test";
import { canonical } from "../src/canon";
import { Staffing } from "../src/readers/staffing";
import { Randomness } from "../src/rng";

const ctx: any = { participant: "works-system", entity: "city", rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 0 }, params: {} };

test("a job offer is well-formed whether or not the employer states a notice period (a works department that didn't gave NaN)", () => {
  const withNotice = new Staffing(ctx, "city", { period: 14 * 86_400, notice_days: 14, workplace: "town-hall/workplace.1", role: "works crew" }).jobOffer(150_000, "acc-city");
  expect(withNotice.terms!.termination).toEqual([{ party: "city", notice: 14 * 86_400 }, { party: "taker", notice: 14 * 86_400 }]);
  const without = new Staffing(ctx, "city", { period: 14 * 86_400, notice_days: undefined as any, workplace: "town-hall/workplace.1", role: "works crew" }).jobOffer(150_000, "acc-city");
  expect(without.terms!.termination).toBeUndefined();
  for (const o of [withNotice, without]) expect(() => canonical(o)).not.toThrow(); // (a NaN anywhere can't be written)
});
