// The richer record's arithmetic (docs/design/ai-citizens.md 10c, 10d; docs/behaviour/citizen.md "The record"): trust,
// agency, what is thought and what is said, values that drift and are shocked, upbringing, bounded ties and memory.
// No model, no clock; every draw from a stream handed in.

import { expect, test } from "bun:test";
import { Inner, INNER_DEFAULTS, innerParams, raisedValues, UPBRINGING } from "../src/behaviour/inner";
import { drawValues, Ties, VALUES } from "../src/behaviour/mind";
import { Randomness } from "../src/rng";

const DAY = 86_400;
const R = new Randomness(7n);
const rng = (k: string) => R.stream(["test", k]);
const POP = Object.fromEntries(VALUES.map((v, i) => [v, { mean_bps: 4_000 + 300 * i, sd_bps: 1_500 }])) as any;
const person = (k: string, outlook = {}) => {
  const values = drawValues(rng(`v-${k}`), { values: POP });
  return { values, inner: new Inner(rng(`i-${k}`), values, POP, outlook, innerParams({})) };
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const corr = (a: number[], b: number[]) => mean(a.map((x, i) => (x - mean(a)) * (b[i]! - mean(b)))) / (sd(a) * sd(b));

test("trust in a particular institution starts from its kind's figure for the place, is lost faster than it is won, counts hearsay for less, and drifts back", () => {
  const starts = Array.from({ length: 400 }, (_, i) => person(`t${i}`, { trust: { banks: 3_000, policing: 8_000 } }).inner);
  expect(Math.abs(mean(starts.map((x) => x.trustIn("bank", "banks", 0))) - 3_000)).toBeLessThan(250);
  expect(Math.abs(mean(starts.map((x) => x.trustIn("constabulary", "policing", 0))) - 8_000)).toBeLessThan(250);
  // (No figure for a kind: the placeholder.)
  expect(Math.abs(mean(starts.map((x) => x.trustIn("landlord-1", "other", 0))) - INNER_DEFAULTS.trust.start_bps)).toBeLessThan(250);
  const { inner } = person("a", { trust: { banks: 5_000 } });
  const base = inner.trustIn("bank", "banks", 0);
  const good = inner.experience("bank", "banks", true, 0);
  expect(good.after).toBeGreaterThan(good.before);
  const { inner: b } = person("a", { trust: { banks: 5_000 } });
  const bad = b.experience("bank", "banks", false, 0);
  expect(bad.before - bad.after).toBeGreaterThan(good.after - good.before);
  const { inner: c } = person("a", { trust: { banks: 5_000 } });
  const heard = c.experience("bank", "banks", false, 0, { heard: true });
  expect(heard.before - heard.after).toBeLessThan(bad.before - bad.after);
  expect(heard.before - heard.after).toBeGreaterThan(0);
  // Two years on, half the distance back to where they started.
  b.settle(INNER_DEFAULTS.trust.return_half_life_days * DAY);
  expect(Math.abs(b.trusted("bank")! - (base - (base - bad.after) / 2))).toBeLessThanOrEqual(2);
  // Bounded: only so many are kept, the longest unused giving way.
  for (let i = 0; i < 40; i++) inner.trustIn(`office-${i}`, "civil_service", i + 1);
  expect(inner.sections().trust.length).toBe(INNER_DEFAULTS.trust.kept);
  expect(inner.trusted("bank")).toBeUndefined();
});

test("a sense of agency rises with what worked, falls with what failed and with what was done to the person, and returns to their own", () => {
  const { inner } = person("g");
  const own = inner.agencyBase;
  inner.tried(true);
  expect(inner.agency).toBeGreaterThan(own);
  inner.tried(false);
  inner.tried(false);
  expect(inner.agency).toBeLessThan(own);
  const before = inner.agency;
  inner.doneTo();
  expect(Math.round(before - inner.agency)).toBe(Math.min(Math.round(before), INNER_DEFAULTS.agency.done_to_bps));
  inner.settle(INNER_DEFAULTS.agency.return_half_life_days * DAY * 20);
  expect(Math.abs(inner.agency - own)).toBeLessThan(1);
  expect(inner.sections().agency).toEqual({ now: own, own });
});

test("what is said is what is thought when nothing is feared, and leans to what others say under fear of someone one depends on and does not trust; the principled give less", () => {
  const { inner } = person("v");
  expect(inner.view("landlord", -6_000, { dependence: 8_000, fear: 0, trust: 2_000, norm: 3_000 })).toEqual({ of: "landlord", private: -6_000, expressed: -6_000 });
  const afraid = inner.view("landlord", -6_000, { dependence: 8_000, fear: 9_000, trust: 2_000, norm: 3_000 });
  expect(afraid.private).toBe(-6_000);
  expect(afraid.expressed).toBeGreaterThan(-6_000);
  expect(afraid.expressed).toBeLessThanOrEqual(3_000);
  // Trusted not to hold it against us: nothing is held back.
  expect(inner.view("landlord", -6_000, { dependence: 8_000, fear: 9_000, trust: 10_000, norm: 3_000 }).expressed).toBe(-6_000);
  // With nobody heard, the lean is toward saying nothing.
  const quiet = inner.view("boss", -6_000, { dependence: 8_000, fear: 9_000, trust: 2_000 });
  expect(quiet.expressed).toBeGreaterThan(-6_000);
  expect(quiet.expressed).toBeLessThanOrEqual(0);
  // Across people: the gap is smaller for those who hold self-direction and universalism over conformity and security.
  const gaps = Array.from({ length: 300 }, (_, i) => {
    const p = person(`p${i}`);
    const integrity = (p.inner.zOf("self_direction") + p.inner.zOf("universalism")) / 2 - (p.inner.zOf("conformity") + p.inner.zOf("security")) / 2;
    return { integrity, gap: p.inner.view("x", -6_000, { dependence: 8_000, fear: 9_000, trust: 2_000, norm: 3_000 }).expressed + 6_000 };
  });
  expect(corr(gaps.map((g) => g.integrity), gaps.map((g) => g.gap))).toBeLessThan(-0.5);
  // Bounded: a few power-holders, the latest kept.
  for (let i = 0; i < 9; i++) inner.view(`who-${i}`, 0, { dependence: 0, fear: 0, trust: 0 });
  expect(inner.sections().views.length).toBe(INNER_DEFAULTS.views.kept);
});

test("values drift slowly: after the stated time a person's values are as alike to their own as the source says, and the town's spread is what it was", () => {
  const P = INNER_DEFAULTS.values;
  const people = Array.from({ length: 600 }, (_, i) => person(`d${i}`));
  const before = people.map((p) => ({ ...p.values }));
  const streams = people.map((_, i) => (purpose: string) => rng(`drift-${i}-${purpose}`));
  people.forEach((p, i) => expect(p.inner.drift(streams[i]!, 0)).toBe(false)); // (the first call only starts the count)
  people.forEach((p, i) => expect(p.inner.drift(streams[i]!, P.stability_days * DAY)).toBe(true));
  for (const v of ["security", "stimulation", "benevolence"] as const) {
    const a = before.map((x) => x[v]), b = people.map((p) => p.values[v]);
    expect(Math.abs(corr(a, b) - P.stability_bps / 10_000)).toBeLessThan(0.08);
    expect(Math.abs(sd(b) - sd(a))).toBeLessThan(150);
    expect(Math.abs(mean(b) - mean(a))).toBeLessThan(150);
  }
  // The same streams, the same drift.
  const again = Array.from({ length: 5 }, (_, i) => person(`d${i}`));
  again.forEach((p, i) => { p.inner.drift(streams[i]!, 0); p.inner.drift(streams[i]!, P.stability_days * DAY); });
  again.forEach((p, i) => expect(p.values).toEqual(people[i]!.values));
  // A month is a small step.
  const one = person("month");
  const was = { ...one.values };
  one.inner.drift((k) => rng(`m-${k}`), 0);
  one.inner.drift((k) => rng(`m-${k}`), 30 * DAY);
  expect(Math.max(...VALUES.map((v) => Math.abs(one.values[v] - was[v])))).toBeLessThan(1_500);
});

test("a shock moves the values the literature says, by its closeness; it dents belonging and meaning, which heal; and it is remembered", () => {
  const { inner, values } = person("s");
  const was = { ...values };
  inner.happened("bereaved", 1_000, { about: "c0002" });
  const S = INNER_DEFAULTS.values.shock_bps;
  expect(values.security - was.security).toBe(S);
  expect(values.tradition - was.tradition).toBe(S);
  expect(values.stimulation - was.stimulation).toBe(-S);
  expect(values.achievement).toBe(was.achievement);
  const D = INNER_DEFAULTS.needs.dents.bereaved!;
  expect(inner.dent("meaning", 1_000)).toBe(D.meaning!);
  expect(inner.dent("belonging", 1_000)).toBe(D.belonging!);
  expect(inner.dent("meaning", 1_000 + INNER_DEFAULTS.needs.dent_half_life_days * DAY)).toBe(D.meaning! / 2);
  expect(inner.sections().memory.defining).toEqual([{ t: 1_000, what: "bereaved", about: "c0002", size: 5_000 }]);
  // A friend's death, at half the closeness: half of each.
  const far = person("s2");
  const wasFar = { ...far.values };
  far.inner.happened("bereaved", 0, { closeness: 0.5 });
  expect(far.values.security - wasFar.security).toBe(S / 2);
  expect(far.inner.dent("meaning", 0)).toBe(D.meaning! / 2);
  // A child: conservation up, for the one who bears it.
  const mother = person("s3");
  const wasM = { ...mother.values };
  mother.inner.happened("child", 0);
  expect(mother.values.conformity - wasM.conformity).toBe(S);
  expect(mother.values.hedonism - wasM.hedonism).toBe(-S);
  expect(mother.inner.dent("meaning", 0)).toBe(0);
});

test("memory is bounded: the last few things, and the few largest kept for good", () => {
  const { inner } = person("m");
  for (let i = 0; i < 500; i++) inner.remember({ t: i, what: i % 50 === 0 ? "bereaved" : "talked", size: i % 50 === 0 ? 5_000 + i : 100 });
  const m = inner.sections().memory;
  expect(m.recent.length).toBe(INNER_DEFAULTS.memory.recent);
  expect(m.recent.at(-1)!.t).toBe(499);
  expect(m.defining.length).toBe(INNER_DEFAULTS.memory.defining);
  expect(m.defining.map((x) => x.size).sort((a, b) => a - b)).toEqual([5_300, 5_350, 5_400, 5_450]);
  expect(inner.takeSince().length).toBeLessThanOrEqual(16);
  expect(inner.takeSince()).toEqual([]);
});

test("attachments grow with time, fade when cut, and give way to a new one", () => {
  const { inner } = person("at");
  inner.attach("trade", "retail", 0);
  inner.settle(0);
  expect(inner.attachedTo("trade")).toBe(0);
  inner.attach("trade", "retail", INNER_DEFAULTS.attach.trade_half_life_days * DAY);
  inner.settle(INNER_DEFAULTS.attach.trade_half_life_days * DAY);
  expect(inner.attachedTo("trade", "retail")).toBe(5_000);
  expect(inner.attachedTo("trade", "mining")).toBe(0);
  // Out of work: it fades; in another trade long enough after, the new one begins.
  const t1 = (INNER_DEFAULTS.attach.trade_half_life_days + INNER_DEFAULTS.attach.fade_half_life_days) * DAY;
  inner.attach("trade", undefined, t1);
  inner.settle(t1);
  expect(inner.attachedTo("trade")).toBe(2_500);
  const t2 = t1 + 5 * INNER_DEFAULTS.attach.fade_half_life_days * DAY;
  inner.attach("trade", "mining", t2);
  expect(inner.sections().attached.trade).toEqual({ to: "mining", bps: 0, since: t2 });
});

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

test("ties are bounded, keep how far each is trusted and what last passed, and give the closest few and the few most resented", () => {
  const ties = new Ties(180, 15, 4_000);
  for (let i = 0; i < 60; i++) ties.add(`c${i}`, 100 + i * 10, 0, "met");
  ties.add("friend", 5_000, 0, "tip");
  ties.add("landlord-3", -3_000, 0, "notice");
  ties.add("boss", -1_000, 0, "let_go");
  // Kept: fifteen, the faintest gone; the strong ones, either way, stay.
  expect(ties.closest(100, 0).length + ties.resented(100, 0).length).toBe(15);
  expect(ties.closest(5, 0)[0]).toEqual({ who: "friend", affinity: 5_000, trust: 4_000, last: { what: "tip", t: 0 } });
  expect(ties.resented(3, 0).map((x) => x.who)).toEqual(["landlord-3", "boss"]);
  expect(ties.affinity("c0", 0)).toBe(0);
  ties.trusted("friend", true, 2_000);
  expect(ties.trust("friend")).toBe(5_200);
  ties.trusted("friend", false, 5_000);
  expect(ties.trust("friend")).toBe(2_600);
  ties.drop("friend");
  expect(ties.closest(5, 0).some((x) => x.who === "friend")).toBe(false);
  // Without contact it fades, toward nothing.
  expect(ties.affinity("landlord-3", 180 * DAY)).toBe(-1_500);
});

test("whatever happens, for however long, the sections stay within their bounds (the contract's: orchestrator/test/entity-records.test.ts holds a run's to the schema)", () => {
  const { inner } = person("long");
  const r = rng("long");
  const whats = ["bereaved", "job_lost", "evicted", "ruined", "child", "turned_away", "hired", "talked"];
  let largest = 0;
  let first = 0;
  for (let week = 0; week < 5_000; week++) {
    const t = week * 7 * DAY;
    inner.settle(t);
    inner.drift((k) => rng(`long-${k}`), t);
    inner.happened(whats[r.below(whats.length)]!, t, { about: `c${r.below(900)}`, closeness: r.below(101) / 100 });
    inner.experience(`office-${r.below(300)}`, "civil_service", r.below(2) === 0, t, { heard: r.below(2) === 0 });
    inner.view(`boss-${r.below(50)}`, r.below(20_001) - 10_000, { dependence: r.below(10_001), fear: r.below(10_001), trust: r.below(10_001), norm: r.below(20_001) - 10_000 });
    inner.attach("trade", r.below(3) ? `trade-${r.below(4)}` : undefined, t);
    inner.attach("place", "town", t);
    inner.tried(r.below(2) === 0);
    inner.spent(["work", "home", "away"][r.below(3)]!, 7 * DAY);
    const s = { ...inner.sections(), hours: inner.takeHours(t) };
    inner.takeSince();
    const size = JSON.stringify(s).length;
    largest = Math.max(largest, size);
    if (week === 2_500) first = largest;
    expect(s.trust.length).toBeLessThanOrEqual(12);
    expect(s.views.length).toBeLessThanOrEqual(4);
    expect(s.memory.recent.length + s.memory.defining.length).toBeLessThanOrEqual(12);
  }
  // It does not grow: the most it held in a hundred years is the most it held in the first fifty (but for a digit
  // more in a time), and far under the kernel's cap.
  expect(largest).toBeLessThan(first * 1.03);
  expect(largest).toBeLessThan(2_500);
});
