import { expect, test } from "bun:test";
import { Attractions, appraise, drawPerson, factsOf, Feelings, Pursuit, satisfaction, strategy, Ties, value, NEEDS, VALUES } from "../src/behaviour/mind";
import { Randomness } from "../src/rng";

const rng = (k: string) => new Randomness(7n).stream([k]);
const pop = { values: { security: { mean_bps: 7000, sd_bps: 1000 }, stimulation: { mean_bps: 3000, sd_bps: 1000 } } };

test("a person is drawn deterministically from the world's figures; values set temperament and how much needs weigh", () => {
  const a = drawPerson(rng("p1"), pop);
  expect(drawPerson(rng("p1"), pop)).toEqual(a); // the same stream, the same person
  expect(drawPerson(rng("p2"), pop)).not.toEqual(a); // people differ
  for (const v of VALUES) expect(a.values[v]).toBeGreaterThanOrEqual(0);
  // Over many people: security valued on average near its mean, and weighing the security need more than subsistence.
  const people = Array.from({ length: 400 }, (_, i) => drawPerson(rng(`p${i}`), pop));
  const mean = (f: (p: (typeof people)[number]) => number) => people.reduce((s, p) => s + f(p), 0) / people.length;
  expect(Math.abs(mean((p) => p.values.security) - 7000)).toBeLessThan(250);
  expect(mean((p) => p.weights.security)).toBeGreaterThan(mean((p) => p.weights.subsistence));
  // Openness follows stimulation and self-direction: those valuing stimulation less are less open.
  expect(mean((p) => p.temperament.openness)).toBeLessThan(5000);
});

test("CONSUMAT: satisfied and certain repeat; satisfied and uncertain imitate; unsatisfied and certain compare; unsatisfied and uncertain deliberate", () => {
  const t = { aspiration_bps: 6000, certainty_bps: 5000 };
  expect(strategy(8000, 8000, t)).toBe("repeat");
  expect(strategy(8000, 2000, t)).toBe("imitate");
  expect(strategy(3000, 8000, t)).toBe("compare");
  expect(strategy(3000, 2000, t)).toBe("deliberate");
  const p = drawPerson(rng("s"), pop);
  const full = Object.fromEntries(NEEDS.map((n) => [n, 10_000])) as any;
  expect(satisfaction(p, full)).toBe(10_000);
  expect(satisfaction(p, { ...full, security: 0 })).toBeLessThan(10_000);
});

test("experience-weighted attraction: an option that pays is chosen more, and an open person explores more", () => {
  const e = new Attractions();
  for (let i = 0; i < 10; i++) e.update("good", 3_000, { bad: -1_000 });
  expect(e.get("good")).toBeGreaterThan(e.get("bad"));
  expect(e.known("good") && e.known("bad")).toBe(true);
  const pickGood = (openness: number) => Array.from({ length: 2000 }, (_, i) => e.choose(rng(`c${i}`), [{ key: "good", value: 0 }, { key: "bad", value: 0 }], openness).key).filter((k) => k === "good").length;
  const closed = pickGood(0);
  const open = pickGood(10_000);
  expect(closed).toBeGreaterThan(1000);
  expect(open).toBeLessThan(closed); // explores more
  // Past attraction decays without new payoffs.
  const before = e.get("good");
  e.update("bad", 0);
  expect(e.get("good")).toBeLessThan(before);
});

test("an offer's facts, from its typed terms: a job's wage and hours, a home's rent, goods per unit; words count for nothing here", () => {
  const job = { terms: { commitments: [
    { who: "shop-3", does: { outcome: { money: { from: "acc-shop-3", amount: "211356" } } }, every: 1_209_600 },
    { who: "taker", does: { outcome: { occupancy: { in: "shop-3-premises/workplace.1" } } } },
  ] } };
  expect(factsOf(job)).toEqual({ money_per_month: Math.round((211_356 * 2_592_000) / 1_209_600), work_hours_per_month: 160 });
  const lease = { terms: { commitments: [
    { who: "landlord-1", does: { outcome: { occupancy: { in: "apts-1/dwelling.1" } } } },
    { who: "taker", does: { outcome: { money: { to: "acc-landlord-1", amount: "180000" } } }, every: 2_592_000 },
  ] } };
  expect(factsOf(lease)).toEqual({ money_per_month: -180_000, home: {} });
  const goods = { terms: { commitments: [
    { who: "taker", does: { outcome: { money: { to: "acc-shop-1", amount: "13000" } } }, per: "unit" },
    { who: "shop-1", does: { outcome: { goods: { kind: "goods", quantity: "1" } } }, per: "unit" },
  ] } };
  expect(factsOf(goods, 5)).toEqual({ money_per_month: -65_000, goods_per_month: 5 });
  const words = { terms: { commitments: [{ who: "church", does: { text: "Counts the taker among its members." } }] } };
  expect(factsOf(words)).toEqual({ money_per_month: 0 });
});

test("appraising: a home matters most to the homeless; money matters less the more one has", () => {
  const p = drawPerson(rng("a"), pop);
  const lease = { money_per_month: -150_000, home: {} };
  const homeless = value(p, appraise(p, lease, { monthly_income: 500_000, savings: 0, homeless: true }));
  const housed = value(p, appraise(p, lease, { monthly_income: 500_000, savings: 0, homeless: false }));
  expect(homeless).toBeGreaterThan(housed);
  const raise = { money_per_month: 50_000 };
  const poor = appraise(p, raise, { monthly_income: 200_000, savings: 0, homeless: false }).security;
  const rich = appraise(p, raise, { monthly_income: 2_000_000, savings: 0, homeless: false }).security;
  expect(poor).toBeGreaterThan(rich);
});

test("word of mouth: what someone says they get from an option moves what's learned of it, less than one's own experience", () => {
  const heard = new Attractions(undefined, 5_000);
  heard.hear("shop-a", 1_000);
  expect(heard.known("shop-a")).toBe(true); // heard of: known, so a person is surer of their options
  expect(heard.get("shop-a")).toBeLessThan(5_000);
  const tried = new Attractions(undefined, 5_000);
  tried.update("shop-a", 1_000);
  expect(tried.get("shop-a")).toBeLessThan(heard.get("shop-a")); // one's own experience counts for more
  // The more one has tried, the less a single report moves it.
  const seasoned = new Attractions(undefined, 5_000);
  for (let i = 0; i < 10; i++) seasoned.update("shop-a", 9_000);
  const before = seasoned.get("shop-a");
  seasoned.hear("shop-a", 1_000);
  expect(before - seasoned.get("shop-a")).toBeLessThan(5_000 - heard.get("shop-a"));
});

test("feelings fade by their half-life; a milder cause doesn't lessen a stronger feeling; ties fade without contact", () => {
  const DAY = 86_400;
  const f = new Feelings();
  f.feel("anger", "landlord-1", 6_000, 0);
  expect(f.level("anger", "landlord-1", 0)).toBe(6_000);
  expect(f.level("anger", "landlord-1", 60 * DAY)).toBe(3_000); // anger's half-life: 60 days
  f.feel("anger", "landlord-1", 1_000, 60 * DAY);
  expect(f.level("anger", "landlord-1", 60 * DAY)).toBe(3_000);
  f.add("anger", "landlord-1", 5_000, 60 * DAY); // half the way to its strongest
  expect(f.level("anger", "landlord-1", 60 * DAY)).toBe(6_500);
  expect(f.level("gratitude", "landlord-1", 0)).toBe(0); // about someone, one feeling doesn't make another
  const t = new Ties();
  t.add("c1", 2_000, 0);
  t.add("c1", 300, 0);
  expect(t.affinity("c1", 0)).toBe(2_300);
  expect(t.affinity("c1", 180 * DAY)).toBe(1_150);
  t.add("c2", -20_000, 0);
  expect(t.affinity("c2", 0)).toBe(-10_000);
});

test("a goal is pursued by one method after another, and runs out", () => {
  const g = new Pursuit("make ends meet", ["spend less", "cheaper home"], 0);
  expect(g.method).toBe("spend less");
  expect(g.next(90)).toBe("cheaper home");
  expect(g.since).toBe(90);
  expect(g.next(180)).toBeUndefined();
});
