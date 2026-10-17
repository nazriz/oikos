// A strike settles by what a stoppage costs each side (docs/behaviour/unions.md, "Concession"; Hicks 1932): the employer
// concedes up to what holding out another stoppage would cost it in sales; the union stops striking when a stoppage costs
// its members more than the rest of the gap would add over a year. No settlement is set anywhere.

import { expect, test } from "bun:test";
import { concessionBps, Takings } from "../src/behaviour/firms";
import { stopsStriking } from "../src/behaviour/union";

const DAY = 86_400;
const works = { strikersBps: 9000, systemBps: 0, takingsPerDay: 1_000_000, lastDays: 2, yearBill: 120_000_000 };

test("an employer concedes what another, longer stoppage would cost it in sales, as a rise on its year's wage bill", () => {
  // 90% of its work stopped for 3 days of $10,000 takings: $27,000 of sales, 0.2% of a $1.2M year's bill, 22 tenths.
  expect(concessionBps(works)).toEqual({ cost: 27_000_00, riseBps: 220 });
  // A longer last stoppage, more takings, more of the work stopped: each concedes more.
  expect(concessionBps({ ...works, lastDays: 5 }).riseBps).toBeGreaterThan(concessionBps(works).riseBps);
  expect(concessionBps({ ...works, takingsPerDay: 2_000_000 }).riseBps).toBeGreaterThan(concessionBps(works).riseBps);
  expect(concessionBps({ ...works, strikersBps: 4500 }).riseBps).toBeLessThan(concessionBps(works).riseBps);
  // A dearer wage bill is a rise that costs more: it concedes less of a rise.
  expect(concessionBps({ ...works, yearBill: 240_000_000 }).riseBps).toBeLessThan(concessionBps(works).riseBps);
});

test("an employer whose strikers' work systems do concedes less than one whose strikers' work nobody else does", () => {
  const without = concessionBps(works);
  const half = concessionBps({ ...works, systemBps: 5000 });
  const all = concessionBps({ ...works, systemBps: 10_000 });
  expect(half.riseBps).toBeLessThan(without.riseBps);
  expect(half.cost).toBe(without.cost / 2);
  expect(all).toEqual({ cost: 0, riseBps: 0 });
});

test("no takings, no wage bill, or no strikers: nothing to concede, and nothing is invented", () => {
  expect(concessionBps({ ...works, takingsPerDay: 0 }).riseBps).toBe(0);
  expect(concessionBps({ ...works, strikersBps: 0 }).riseBps).toBe(0);
  expect(concessionBps({ ...works, yearBill: 0 }).riseBps).toBe(0);
});

test("takings are a month's, per day, over the days it has been taking if fewer", () => {
  const k = new Takings();
  expect(k.perDay(10 * DAY)).toBe(0);
  k.add(0, 3_000);
  k.add(5 * DAY, 3_000);
  expect(k.perDay(6 * DAY)).toBe(1_000); // 6,000 over 6 days
  expect(k.perDay(40 * DAY)).toBe(0); // (nothing in the last month)
  k.add(39 * DAY, 30_000);
  expect(k.perDay(40 * DAY)).toBe(1_000); // 30,000 over 30 days
});

test("a union with a large gap and small pay at stake keeps striking; one with a small gap and large pay at stake stops", () => {
  // 40 members, $100 a day: a 3-day stoppage costs $12,000.
  const big = stopsStriking({ members: 40, days: 3, payPerDay: 10_000, claimBps: 500, standingBps: 100 }); // 4% still to win: $5.8M a year
  expect(big.stop).toBe(false);
  expect(big.cost).toBe(1_200_000);
  expect(big.gain).toBe(40 * 10_000 * 365 * 400 / 10_000);
  const small = stopsStriking({ members: 40, days: 3, payPerDay: 10_000, claimBps: 500, standingBps: 450 }); // 0.5% to win: worth 1.8 days' pay
  expect(small.stop).toBe(true);
  // At every gap, the longer the stoppage the sooner it stops; the wider the gap, the longer it holds.
  const at = (days: number, gap: number) => stopsStriking({ members: 40, days, payPerDay: 10_000, claimBps: gap, standingBps: 0 }).stop;
  expect(at(1, 60)).toBe(false);
  expect(at(3, 60)).toBe(true);
  expect(at(3, 200)).toBe(false);
  // A claim met in full costs nothing more to win: it stops. A union that does not know the pay cannot weigh it.
  expect(stopsStriking({ members: 40, days: 1, payPerDay: 10_000, claimBps: 500, standingBps: 500 }).stop).toBe(true);
  expect(stopsStriking({ members: 40, days: 1, payPerDay: 0, claimBps: 500, standingBps: 500 }).stop).toBe(false);
});

test("no settlement is a constant: the same rules, other costs, other rises", () => {
  const rises = new Set([0, 1_000_000, 5_000_000, 20_000_000, 40_000_000].map((takingsPerDay) => concessionBps({ ...works, takingsPerDay }).riseBps));
  expect(rises.size).toBe(5);
});
