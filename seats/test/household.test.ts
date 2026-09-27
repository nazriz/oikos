import { expect, test } from "bun:test";
import { bedroomsNeeded, hear, SAYING, type HouseholdData, type Member } from "../src/behaviour/household";

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
