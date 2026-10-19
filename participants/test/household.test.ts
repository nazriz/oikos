import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adultAgeBands, bedroomsNeeded, drawHousehold, OCCUPANCY, type DrawnHousehold, type HouseholdData, type HouseholdSpec, type Member } from "../src/shared/household";
import { Randomness } from "../src/rng";
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

// Brothers and sisters are a year or more apart (docs/behaviour/households.md): the years between them are drawn first,
// and the eldest is at least as old as they add up to. Drawn the other way round (until 2026-10-08), a younger child's
// age stopped at nought, so an eldest of one or two had siblings all born the same year, and 8.2% of the generated town
// was under five where the census has 5.4%.
test("no two children of a family are the same age, and the under-fives are the census's share", () => {
  const H = { ...PROFILE.values.households } as unknown as HouseholdSpec;
  const a = new Randomness(1n).stream(["bands"]), b = new Randomness(1n).stream(["draw"]);
  H.adult_age_bands = adultAgeBands(H, (n) => a.below(n));
  let people = 0, underFive = 0, twins = 0;
  for (let i = 0; i < 20_000; i++) {
    const d = drawHousehold(H, (n) => b.below(n));
    const kids = d.members.filter((m) => m.parents).map((m) => m.age);
    if (new Set(kids).size < kids.length) twins++;
    people += d.members.length;
    underFive += d.members.filter((m) => m.age < 5).length;
  }
  expect(twins).toBe(0);
  const census = H.age_bands_bps!.reduce((x, c) => x + (c.from < 5 ? c.bps : 0), 0) / H.age_bands_bps!.reduce((x, c) => x + c.bps, 0);
  expect(Math.abs((100 * underFive) / people - 100 * census)).toBeLessThan(1);
});

// ---- extended households (docs/behaviour/households.md): a family with relatives beyond it in the same home ----

const SPEC = () => ({ ...PROFILE.values.households }) as unknown as HouseholdSpec;
const drawMany = (H: HouseholdSpec, n = 20_000) => {
  const r = new Randomness(1n).stream(["draw"]);
  return Array.from({ length: n }, () => drawHousehold(H, (k) => r.below(k)));
};
const kindsTotal = (H: HouseholdSpec) => H.lone_bps + H.group_bps + H.couple_bps + H.couple_children_bps + H.one_parent_bps + (H.extended_bps ?? 0);
/** Three generations under one roof: a child whose parent's parent lives there too. */
const threeGenerations = (d: DrawnHousehold) => d.members.some((m) => m.parents?.some((p) => d.members[p]!.parents?.length));

test("a spec with no extended households draws exactly what it drew before the kind existed", () => {
  // The draws are the same in number and order: nothing is drawn for a kind the spec doesn't have, whatever else it says.
  const plain = drawMany(SPEC(), 2_000);
  expect(plain.some((d) => d.extended)).toBe(false);
  expect(drawMany({ ...SPEC(), extended_bps: 0 }, 2_000)).toEqual(plain);
  expect(drawMany({ ...SPEC(), extended_nucleus: [1, 1, 1], extensions: [{ kind: "parents", share_bps: 1 }] }, 2_000)).toEqual(plain);
  // And the ages derived for the adults no family places are the same.
  const a = new Randomness(1n).stream(["bands"]), b = new Randomness(1n).stream(["bands"]);
  expect(adultAgeBands({ ...SPEC(), extended_bps: 0 }, (n) => b.below(n), 2_000)).toEqual(adultAgeBands(SPEC(), (n) => a.below(n), 2_000));
});

test("extended households come at the stated share, and each kind of relative is what it says", () => {
  const base = SPEC();
  // A quarter of all households extended; each kind a quarter of those.
  const H: HouseholdSpec = { ...base, extended_bps: Math.round(kindsTotal(base) / 3), extensions: [
    { kind: "parents", share_bps: 2500, count: [1, 2] }, { kind: "child_family", share_bps: 2500, count: [2, 2] },
    { kind: "sibling", share_bps: 2500, count: [1, 2] }, { kind: "relative", share_bps: 2500, count: [1, 3] }] };
  const [lo, hi] = H.adult_ages;
  const [gapLo, gapHi] = H.mother_age_at_first_birth;
  const draws = drawMany(H);
  const of = (k: string) => draws.filter((d) => d.extended === k);
  const pct = (n: number) => (100 * n) / draws.length;
  expect(Math.abs(pct(draws.filter((d) => d.extended).length) - 25)).toBeLessThan(1.5);
  for (const k of ["parents", "child_family", "sibling", "relative"]) expect(Math.abs(pct(of(k).length) - 6.25)).toBeLessThan(1);
  // A parent of the family's head, or both: recorded as the head's parents, older by a mother's age at a first birth
  // (or as old as anyone gets); the head keeps the lease.
  for (const d of of("parents")) {
    const head = d.members[d.leaseholder]!;
    expect(head.parents?.length).toBeGreaterThanOrEqual(1);
    const first = d.members[head.parents![0]!]!;
    expect(first.age === hi || (first.age - head.age >= gapLo && first.age - head.age <= gapHi)).toBe(true);
    // Both parents are a couple.
    if (head.parents!.length === 2) expect(d.couples.some((c) => c.includes(head.parents![0]!) && c.includes(head.parents![1]!))).toBe(true);
  }
  expect(of("parents").some((d) => d.members[d.leaseholder]!.parents!.length === 1)).toBe(true);
  expect(of("parents").some((d) => d.couples.length === 2)).toBe(true);
  // The same people the other way round: the family lives in its head's parents' home, and one of them holds the lease.
  for (const d of of("child_family")) {
    const elder = d.members[d.leaseholder]!;
    const child = d.members.find((m) => m.age >= lo && m.parents?.includes(d.leaseholder));
    expect(child).toBeDefined();
    expect(elder.age === hi || (elder.age - child!.age >= gapLo && elder.age - child!.age <= gapHi)).toBe(true);
    expect(d.couples.some((c) => c.includes(d.leaseholder))).toBe(true);
  }
  // Some of each are three generations under one roof (the family in the middle has children); none are otherwise.
  expect(of("parents").some(threeGenerations)).toBe(true);
  expect(of("child_family").some(threeGenerations)).toBe(true);
  expect(draws.filter((d) => d.extended !== "parents" && d.extended !== "child_family").some(threeGenerations)).toBe(false);
  // Brothers and sisters of the head: one or two adults, of other ages than the head's unless at the ends of adult life.
  for (const d of of("sibling")) {
    const sibs = d.members.filter((m) => m.tied);
    expect(sibs.length === 1 || sibs.length === 2).toBe(true);
    const head = d.members[d.leaseholder]!.age;
    for (const s of sibs) expect(s.age >= lo && s.age <= hi && (s.age !== head || head === lo || head === hi)).toBe(true);
  }
  // Other relatives: one to three adults who are nobody's partner, parent or child here.
  for (const d of of("relative")) {
    const others = d.members.filter((m, i) => i !== d.leaseholder && !m.parents && !m.tied && !d.couples.some((c) => c.includes(i)));
    expect(others.length >= 1 && others.length <= 3).toBe(true);
    for (const o of others) expect(o.age).toBeGreaterThanOrEqual(lo);
  }
  // Outside the extended households, nothing has changed kind: nobody's age is tied, and no adult has a parent at home
  // who is not the parent of a family.
  expect(draws.filter((d) => !d.extended).some((d) => d.members.some((m) => m.tied) || threeGenerations(d))).toBe(false);
});

test("the two profiles that state extended households draw them at their share, as their notes describe them", () => {
  const spec = (id: string) => JSON.parse(readFileSync(join(import.meta.dir, `../../worlds/profiles/${id}.json`), "utf8")).values.households as HouseholdSpec;
  const drawn = (H: HouseholdSpec) => {
    const a = new Randomness(1n).stream(["bands"]);
    return drawMany({ ...H, adult_age_bands: adultAgeBands(H, (n) => a.below(n)) });
  };
  const size = (xs: DrawnHousehold[]) => xs.reduce((x, d) => x + d.members.length, 0) / xs.length;
  for (const id of ["jp-akita-2026", "mx-jal-2026"]) {
    const H = spec(id);
    expect(H.extended_bps).toBeGreaterThan(0);
    const draws = drawn(H);
    const ext = draws.filter((d) => d.extended);
    expect(Math.abs((10_000 * ext.length) / draws.length - (10_000 * H.extended_bps!) / kindsTotal(H))).toBeLessThan(150);
    // Larger households than the same shares with that kind left out, by at least the one relative each has.
    const without = drawn({ ...H, extended_bps: undefined });
    expect(size(draws)).toBeGreaterThan(size(without));
    expect(size(ext)).toBeGreaterThanOrEqual(3);
    if (id === "jp-akita-2026") {
      // Three generations, as its author described them: a couple with children and a parent of the head's.
      expect(ext.every((d) => d.extended === "parents" && threeGenerations(d) && d.couples.length >= 1)).toBe(true);
    } else {
      // A family of any of the three kinds and one other relative: all its note gives.
      expect(ext.every((d) => d.extended === "relative")).toBe(true);
      expect(ext.some((d) => d.couples.length === 0)).toBe(true);
      expect(ext.some((d) => d.couples.length === 1 && !d.members.some((m) => m.parents))).toBe(true);
    }
    // Nobody is older than the oldest adult, however the generations stack.
    expect(Math.max(...draws.flatMap((d) => d.members.map((m) => m.age)))).toBeLessThanOrEqual(H.adult_ages[1]);
  }
  // The other profiles state none, and draw none.
  for (const id of ["au-vic-2026", "br-mg-2026", "de-ni-2026", "gb-eng-2026", "in-tn-2026", "ke-nakuru-2026", "us-oh-2026"]) expect(spec(id).extended_bps).toBeUndefined();
});

test("the occupancy standard's figures are a place's: more to a bedroom, a room of one's own from another age, a living room slept in", () => {
  const family = hh([m("a", 40, "female"), m("b", 41, "male"), m("c", 19, "male"), m("d", 16, "male"), m("e", 9, "female"), m("f", 7, "female"), m("g", 6, "female")], [["a", "b"]]);
  // The common standard: the couple, the son of 19, the boy of 16, and two rooms for three girls.
  expect(bedroomsNeeded(family, T, YEAR)).toBe(5);
  expect(bedroomsNeeded(family, T, YEAR, OCCUPANCY)).toBe(5);
  // Three to a bedroom: the three girls share.
  expect(bedroomsNeeded(family, T, YEAR, { ...OCCUPANCY, per_bedroom: 3 })).toBe(4);
  // A room of one's own only from 21: the sons of 19 and 16 share.
  expect(bedroomsNeeded(family, T, YEAR, { ...OCCUPANCY, own_from_age: 21 })).toBe(4);
  // A living room that is slept in: one bedroom fewer.
  expect(bedroomsNeeded(family, T, YEAR, { ...OCCUPANCY, living_room_slept_in: true })).toBe(4);
  // The youngest of different sexes share under the standard's age: a boy of 8 and a girl of 7 at under 10, not at under 5.
  const two = hh([m("a", 33, "female"), m("c", 8, "male"), m("d", 7, "female")]);
  expect(bedroomsNeeded(two, T, YEAR)).toBe(3);
  expect(bedroomsNeeded(two, T, YEAR, { ...OCCUPANCY, mixed_under_age: 10 })).toBe(2);
  // Three to a bedroom, two boys and a girl left over, all small: the three share one room; not if one is older.
  const small = hh([m("a", 33, "female"), m("c", 4, "male"), m("d", 3, "male"), m("e", 2, "female")]);
  expect(bedroomsNeeded(small, T, YEAR, { ...OCCUPANCY, per_bedroom: 3 })).toBe(2);
  expect(bedroomsNeeded(hh([m("a", 33, "female"), m("c", 9, "male"), m("d", 3, "male"), m("e", 2, "female")]), T, YEAR, { ...OCCUPANCY, per_bedroom: 3 })).toBe(3);
  // Three generations by the common standard: a bedroom for each couple, and the children's by sex.
  const three = hh([m("a", 40, "female"), m("b", 41, "male"), m("c", 12, "male"), m("d", 9, "female"), m("e", 70, "female"), m("f", 72, "male")], [["a", "b"], ["e", "f"]]);
  expect(bedroomsNeeded(three, T, YEAR)).toBe(4);
  // ...and with a widowed grandmother in place of the couple, the same four: she has her own.
  expect(bedroomsNeeded(hh([m("a", 40, "female"), m("b", 41, "male"), m("c", 12, "male"), m("d", 9, "female"), m("e", 70, "female")], [["a", "b"]]), T, YEAR)).toBe(4);
});
