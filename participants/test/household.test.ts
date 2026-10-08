import { expect, test } from "bun:test";
import { adultAgeBands, bedroomsNeeded, drawHousehold, hear, SAYING, type HouseholdData, type HouseholdSpec, type Member } from "../src/behaviour/household";
import { Randomness } from "../src/rng";
import { CATCHING_UP, heardNews } from "../src/behaviour/citizen";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

// The world these tests are in writes its money as the profile says (the platform has no money of its own).
inCurrency(PROFILE.values.currency);

const YEAR = 365 * 86_400;
const T = 40 * YEAR;
const m = (person: string, age: number, sex: "female" | "male"): Member => ({ person, born_at: T - age * YEAR - 1, sex });
const hh = (members: Member[], couples: [string, string][] = []): HouseholdData => ({ leaseholder: members[0]!.person, members, couples });
const need = (h: HouseholdData) => bedroomsNeeded(h, T, YEAR);

test("the occupancy standard (CNOS, as the ABS applies it)", () => {
  // Living alone: a studio will do.
  expect(need(hh([m("a", 30, "female")]))).toBe(0);
  // A couple shares; two unrelated adults don't.
  expect(need(hh([m("a", 30, "female"), m("b", 32, "male")], [["a", "b"]]))).toBe(1);
  expect(need(hh([m("a", 30, "female"), m("b", 32, "male")]))).toBe(2);
  // A couple with two boys (they share) and a girl (her own).
  expect(need(hh([m("a", 40, "female"), m("b", 41, "male"), m("c", 12, "male"), m("d", 9, "male"), m("e", 7, "female")], [["a", "b"]]))).toBe(3);
  // A lone parent has their own room; a boy of 3 and a girl of 2 can share (both under 5).
  expect(need(hh([m("a", 33, "female"), m("c", 3, "male"), m("d", 2, "female")]))).toBe(2);
  // ...but not at 6 and 2.
  expect(need(hh([m("a", 33, "female"), m("c", 6, "male"), m("d", 2, "female")]))).toBe(3);
  // An adult child has their own room.
  expect(need(hh([m("a", 50, "female"), m("b", 52, "male"), m("c", 19, "female")], [["a", "b"]]))).toBe(2);
  // Three girls: two share, one alone.
  expect(need(hh([m("a", 35, "male"), m("c", 10, "female"), m("d", 8, "female"), m("e", 6, "female")]))).toBe(3);
});

test("household members understand their own phrasing, and nothing else", () => {
  expect(hear(SAYING.moveIn("apts-3/dwelling.2"))).toEqual({ kind: "moveIn", space: "apts-3/dwelling.2" });
  expect(hear(SAYING.moveOut("house-4"))).toEqual({ kind: "moveOut", from: "house-4" });
  expect(hear(SAYING.leaving())).toEqual({ kind: "leaving" });
  expect(hear(SAYING.share(42_550, "acc-c0001"))).toEqual({ kind: "share", cents: 42_550, account: "acc-c0001" });
  expect(hear(SAYING.share(0, "acc-c0001"))).toEqual({ kind: "share", cents: 0, account: "acc-c0001" });
  expect(hear(SAYING.pay(257_142))).toEqual({ kind: "pay", cents: 257_142 });
  expect(hear("We should move somewhere bigger.")).toBeUndefined();
});

test("catching up: a code citizen's news reads back as what it says", () => {
  const text = [CATCHING_UP.shop("shop-3", 7_000), CATCHING_UP.work("factory-co-2", true), CATCHING_UP.union(false)].join(" ");
  expect(heardNews(text)).toEqual({ shop: "shop-3", served: 7_500, employer: "factory-co-2", paid: true, member: false });
  expect(heardNews(CATCHING_UP.shop("shop-1", 2_000))).toEqual({ shop: "shop-1", served: 3_500 });
  expect(heardNews([CATCHING_UP.goes("sport-group-1"), CATCHING_UP.goes("union")].join(" "))).toEqual({ goesTo: ["sport-group-1", "union"] });
  expect(heardNews([CATCHING_UP.holds("religious-group-1"), CATCHING_UP.goes("religious-group-1")].join(" "))).toEqual({ goesTo: ["religious-group-1"], holdsTo: ["religious-group-1"] });
  expect(heardNews(CATCHING_UP.leans("religious-group-1"))).toEqual({ leansTo: ["religious-group-1"] });
  expect(heardNews(CATCHING_UP.nothing)).toBeUndefined();
  expect(heardNews("Lovely weather.")).toBeUndefined();
});

// Adults' ages follow the census (docs/behaviour/households.md): those whose age no family decides are drawn from the
// census's adults less the ones families put in each band. Grown children at home are put there by their families as
// parents are; taken off for parents only (until 2026-10-08), the youngest adults were counted twice (16% of adults
// under 25 where the census has 9%) and every band from 50 up came out a fifth short (20% of adults at or past 67
// where the census has 25%).
test("adults' ages follow the census, grown children at home counted among them", () => {
  const H = { ...PROFILE.values.households } as unknown as HouseholdSpec;
  const a = new Randomness(1n).stream(["bands"]), b = new Randomness(1n).stream(["draw"]);
  H.adult_age_bands = adultAgeBands(H, (n) => a.below(n));
  const [lo] = H.adult_ages;
  const share = (from: number, to: number) => H.age_bands_bps!.reduce((x, c) => x + (c.bps * Math.max(0, Math.min(c.to, to) - Math.max(c.from, from) + 1)) / (c.to - c.from + 1), 0);
  let adults = 0, young = 0, old = 0;
  for (let i = 0; i < 20_000; i++) for (const m of drawHousehold(H, (n) => b.below(n)).members) {
    if (m.age < lo) continue;
    adults++;
    if (m.age < 25) young++;
    if (m.age >= 67) old++;
  }
  const pct = (n: number) => (100 * n) / adults, census = (from: number, to: number) => (100 * share(from, to)) / share(lo, 200);
  expect(Math.abs(pct(young) - census(lo, 24))).toBeLessThan(2.5);
  expect(Math.abs(pct(old) - census(67, 200))).toBeLessThan(2.5);
});
