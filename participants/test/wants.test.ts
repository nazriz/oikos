// Wants (docs/design/ai-citizens.md 10a, 10b; participants/src/behaviour/wants.ts): what an opening brings, read from
// its typed terms; a want meeting an opening by what it seeks, by the paper in its way, or by whom it concerns; the
// bounded list, growing and giving up; and the symmetric sway.

import { expect, test } from "bun:test";
import { swayed, Wants, WANT_DEFAULTS, type Want } from "../src/shared/wants";

const DAY = 86_400, MONTH = 30 * DAY;
const posting = { terms: { commitments: [
  { who: "shop-3", does: { outcome: { money: { from: "acc-shop-3", amount: "211356", for: "wages" } } }, every: 14 * DAY },
  { who: "taker", does: { outcome: { work: { task: "serve", at: "shop-3-premises", hours: 273_600 } } }, every: 14 * DAY }] } };
const listing = (rent: number) => ({ terms: { commitments: [
  { who: "landlord-1", does: { outcome: { occupancy: { in: "apts-1/dwelling.2" } } } },
  { who: "taker", does: { outcome: { money: { to: "acc-landlord-1", amount: String(rent) } } }, every: MONTH }] } });
const membership = { terms: { commitments: [
  { who: "union", does: { text: "Represents the member at work, and bargains for them." } },
  { who: "taker", does: { outcome: { money: { to: "acc-union", amount: "2000" } } }, every: MONTH }] } };
const want = (x: Partial<Want>): Want => ({ about: "x", seeks: [], weight: 5_000, since: 0, from: "event", tried: 0, grown: 0, ...x });

test("a record keeps six wants: the lightest gives way, and what became of each is told once", () => {
  const w = new Wants();
  for (let i = 0; i < 7; i++) w.born({ about: `n${i}`, seeks: ["attend"], weight: 1_000 + i * 100, since: i, from: "need" }, i);
  expect(w.all().map((x) => x.about)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
  expect(w.take().map((e) => `${e.kind}:${e.want.about}`)).toEqual(["born:n0", "born:n1", "born:n2", "born:n3", "born:n4", "born:n5", "born:n6", "displaced:n0"]);
  expect(w.take()).toEqual([]);
  expect(w.section()[0]).toEqual({ about: "n6", seeks: [{ attend: { who: "me" } }], weight: 1_600, since: 6, from: "need", tried: 0 });
  // Born again while held: felt at least as much, not twice.
  w.born({ about: "n6", seeks: ["attend"], weight: 3_000, since: 9, from: "need" }, 9);
  expect(w.all().length).toBe(6);
  expect(w.get("n6")!.weight).toBe(3_000);
});

test("a want is due when never tried, then when its way has had its time (the patient wait longer); after its tries it grows for the persistent and is given up by the rest, and rests", () => {
  const w = new Wants();
  const a = w.born({ about: "security", seeks: ["money.to"], weight: 4_000, since: 0, from: "need" }, 0)!;
  expect(w.due(0, 1)).toEqual([a]);
  w.tried(a, "self", 0);
  expect(w.due(44 * DAY, 1)).toEqual([]);
  expect(w.due(45 * DAY, 1)).toEqual([a]);
  expect(w.due(60 * DAY, 1.5)).toEqual([]);
  expect(w.wornOut(a, 45 * DAY, 1)).toBeUndefined();
  w.tried(a, "offer:employment", 45 * DAY);
  w.tried(a, "wait", 90 * DAY);
  expect(w.taking("offer:employment")).toBe(false);
  expect(w.taking("wait")).toBe(true);
  // Three tries: the persistent want it more.
  expect(w.wornOut(a, 135 * DAY, 0.5)).toBe("grown");
  expect(a.weight).toBe(5_000);
  expect(w.wornOut(a, 135 * DAY, 0.5)).toBeUndefined(); // three more tries first
  // The same want in someone who is not: given up, and not born again for a while.
  const v = new Wants();
  const b = v.born({ about: "security", seeks: ["money.to"], weight: 4_000, since: 0, from: "need" }, 0)!;
  for (let i = 0; i < 3; i++) v.tried(b, "self", i * 45 * DAY);
  expect(v.wornOut(b, 135 * DAY, -0.5)).toBe("given_up");
  expect(v.all()).toEqual([]);
  expect(v.born({ about: "security", seeks: ["money.to"], weight: 4_000, since: 0, from: "need" }, 200 * DAY)).toBeUndefined();
  expect(v.born({ about: "security", seeks: ["money.to"], weight: 4_000, since: 0, from: "need" }, (135 + WANT_DEFAULTS.rest_days) * DAY)).toBeDefined();
  expect(v.take().map((e) => e.kind)).toEqual(["born", "pursued", "pursued", "pursued", "given_up", "born"]);
});

test("a want taken up from others, once met, is not taken up from them again for a while", () => {
  const w = new Wants();
  const a = w.born({ about: "social", seeks: ["attend"], weight: 1_000, since: 0, from: "other" }, 0)!;
  w.met(a, 7 * DAY);
  expect(w.born({ about: "social", seeks: ["attend"], weight: 1_000, since: 0, from: "other" }, 14 * DAY)).toBeUndefined();
  expect(w.born({ about: "social", seeks: ["attend"], weight: 1_000, since: 0, from: "other" }, (7 + WANT_DEFAULTS.rest_days) * DAY)).toBeDefined();
  // (But the need itself, short for long, makes it their own want whenever that comes.)
  expect(w.born({ about: "social", seeks: ["attend"], weight: 2_000, since: 0, from: "need" }, 14 * DAY)).toBeDefined();
  // One's own, met, may come back as soon as the need does.
  const b = w.born({ about: "security", seeks: ["money.to"], weight: 1_000, since: 0, from: "need" }, 0)!;
  w.met(b, 7 * DAY);
  expect(w.born({ about: "security", seeks: ["money.to"], weight: 1_000, since: 0, from: "need" }, 14 * DAY)).toBeDefined();
});

test("a sway is symmetric about the town's mean: as far up for one above it as down for one below, and nothing at the mean", () => {
  expect(swayed(3_000, 0, 0.3)).toBe(3_000);
  expect(swayed(3_000, 1, 0.3) - 3_000).toBe(3_000 - swayed(3_000, -1, 0.3));
  expect(swayed(3_000, 10, 0.3)).toBe(swayed(3_000, 3, 0.3)); // (held to three standard deviations)
  expect(swayed(9_000, 3, 0.3)).toBe(10_000);
});
