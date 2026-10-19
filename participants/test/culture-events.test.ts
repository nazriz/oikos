// Events join the picture (docs/behaviour/culture.md, "Events join the picture"): a public event that is an instance of a conduct, seen, read or told, is one
// sighting of it at the route's weight times the event's strength, and the teller's said view is one hearing of approval at the same weight; by the existing rule
// and no size of its own; and by no route but the three. Arithmetic and a citizen's ears only: no model, no clock.

import { expect, test } from "bun:test";

import { cultureDial, type Conduct } from "../src/shared/culture";
import { RECORD } from "../src/module";
import { DAY, person } from "./stepping";
import { engine } from "./engine";
import { TOWN_WORDS } from "./phrasing";
const citizen = engine("citizen.default");

const RATES: { [c in Conduct]?: number } = { strike: 8_500, join_union: 3_500, apply_possession: 5_000, stay_past_notice: 2_000 };
const dial = () => cultureDial({ dials: { culture: {} } })!;

// ---- a citizen

const from = (who: string, text: string, id = "m1") => ({ id, from: `${who}-self`, t: 0, text });
function watched(params: object, dials: object | false = { culture: {} }) {
  const kept = { record: {} as { [section: string]: any } };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); return a; } };
  } };
  return { p: person(module, params, dials ? { dials } : {}), kept };
}
const values = Object.fromEntries(["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"].map((v) => [v, 5_000]));
const PARAMS = { own_values: values, union: "union", strike_vote_yes_bps: 5_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, welfare: { police: "police", channel: "x", found_after: [] } };
const row = (a: ReturnType<typeof watched>, i: number) => (a.kept.record.norms as any[] | undefined)?.[i] as number[] | undefined;
const STRIKE = 6, APPLY = 8, STAY = 1;

test("a citizen told of a walk-out by a tie: the picture of striking moves, once; heard again it does not; the teller's view moves what is approved; hearsay of a law moves nothing", async () => {
  const a = watched(PARAMS);
  await a.p.wake(DAY);
  const does0 = row(a, STRIKE)![0], approves0 = row(a, STRIKE)![1];
  expect(does0).toBe(50);
  // Many tellings (each a different walk-out, each a different tie) so the move shows in whole percent, which is the record's grain.
  for (let i = 0; i < 6; i++) await a.p.wake((2 + i) * DAY, { inbox: [from(`c${20 + i}`, TOWN_WORDS.say("strike", `shop-${i}`, i, 10_000, 0, 1_000), `m${i}`)] });
  const does1 = row(a, STRIKE)![0], approves1 = row(a, STRIKE)![1];
  expect(does1).toBeGreaterThan(does0);
  expect(approves1).toBeLessThan(approves0);
  // The same walk-out told again (by a second tie) is the same event held again: nothing more is counted.
  await a.p.wake(10 * DAY, { inbox: [from("c30", TOWN_WORDS.say("strike", "shop-0", 0, 10_000, 0, 1_000), "m9")] });
  expect(row(a, STRIKE)![0]).toBe(does1);
  expect(row(a, STRIKE)![1]).toBe(approves1);
  // A law told, a ruling told: no conduct of the list, no move.
  const before = JSON.stringify(a.kept.record.norms);
  await a.p.wake(11 * DAY, { inbox: [from("c31", TOWN_WORDS.say("law", "council", 3, 10_000, 0, 1_000), "m10"), from("c32", TOWN_WORDS.say("ruling", "desk", 3, 10_000, 0), "m11")] });
  expect(JSON.stringify(a.kept.record.norms)).toBe(before);
});

test("nobody has a god's view: with nothing seen, read or told, the picture of what people do stays where it started, however much happened in the town", async () => {
  const a = watched(PARAMS);
  await a.p.wake(DAY);
  const start = JSON.stringify(a.kept.record.norms);
  // The town happens around them: a building they are not in shows only that someone was seen leaving; strangers' talk that is not addressed to them is not theirs.
  for (let i = 2; i < 40; i++) await a.p.wake(i * DAY, { street: [{ cell: "c.1", x: 0, y: 0, structure: { structure: "apts-1", type: "apartments", at: "c.1", w: 1, h: 1, complete: true,
    spaces: [{ space: "apts-1/dwelling.2", kind: "dwelling", capacity: 4, count: 0, seen_leaving: 100 + i }] } }] });
  expect(JSON.stringify(a.kept.record.norms)).toBe(start);
  expect(a.kept.record.heard).toBeUndefined();
});

test("a removal told: the landlord applying and the household staying are each one sighting; the dial off hears nothing", async () => {
  const a = watched(PARAMS), off = watched(PARAMS, false);
  await a.p.wake(DAY); await off.p.wake(DAY);
  const apply0 = row(a, APPLY)?.[0], stay0 = row(a, STAY)![0];
  for (let i = 0; i < 6; i++) {
    const m = { inbox: [from(`c${20 + i}`, TOWN_WORDS.say("put_out", "police", i, 10_000, 0), `m${i}`)] };
    await a.p.wake((2 + i) * DAY, m); await off.p.wake((2 + i) * DAY, m);
  }
  expect(row(a, STAY)![0]).toBeGreaterThan(stay0);
  if (apply0 !== undefined) expect(row(a, APPLY)![0]).toBeGreaterThan(apply0);
  expect(off.kept.record.norms).toBeUndefined();
  expect(off.kept.record.heard).toBeUndefined();
});
