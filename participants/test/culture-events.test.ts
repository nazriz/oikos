// Events join the picture (docs/behaviour/culture.md, "Events join the picture"): a public event that is an instance of a conduct, seen, read or told, is one
// sighting of it at the route's weight times the event's strength, and the teller's said view is one hearing of approval at the same weight; by the existing rule
// and no size of its own; and by no route but the three. Arithmetic and a citizen's ears only: no model, no clock.

import { expect, test } from "bun:test";
import { citizen } from "../src/behaviour/citizen";
import { Culture, CULTURE_DEFAULTS, cultureDial, standardNormal, type Conduct, type CultureEnv } from "../src/behaviour/culture";
import { EVENT_CONDUCTS, EVENT_KINDS, TOWN_WORDS, TownMemory } from "../src/behaviour/townmemory";
import { RECORD } from "../src/module";
import { Randomness } from "../src/rng";
import { DAY, person } from "./stepping";

const RATES: { [c in Conduct]?: number } = { strike: 8_500, join_union: 3_500, apply_possession: 5_000, stay_past_notice: 2_000 };
const dial = () => cultureDial({ dials: { culture: {} } })!;
const mk = (i = 1) => {
  const d = dial();
  const env: CultureEnv = { z: () => 0, conformity: () => 0.5, belonging: () => 0.5, integrity: () => 0.5, draw: (c) => standardNormal(new Randomness(3n).stream([`q${i}`, c])) };
  return new Culture(d.params, d, env, RATES, undefined, 0);
};

test("an event is one sighting by the rule that exists: the route's weight times how strongly it is held; a retold event counts for less", () => {
  const P = CULTURE_DEFAULTS;
  const seen = mk(), one = mk(), two = mk(), three = mk(), close = mk(), ref = mk();
  const start = ref.read("strike", 0)!.does;
  seen.sawEvent("strike", "here", 10_000);
  ref.seeAct("strike", true, "here");
  expect(seen.read("strike", 0)!.does).toBe(ref.read("strike", 0)!.does); // (seen, full strength: exactly a sighting by being there)
  one.sawEvent("strike", "tie", 6_000);   // told by a witness: 60% of theirs
  two.sawEvent("strike", "tie", 3_600);   // one hand further
  three.sawEvent("strike", "tie", 2_160); // and one more
  const gain = (c: Culture) => c.read("strike", 0)!.does - start;
  expect(gain(seen)).toBeGreaterThan(gain(one));
  expect(gain(one)).toBeGreaterThan(gain(two));
  expect(gain(two)).toBeGreaterThan(gain(three));
  expect(gain(three)).toBeGreaterThan(0);
  // By the rule, written out: does += (10,000 - does) * w / (n + w), w = weight x strength, n = the prior's weight.
  const w = P.known_weight * 0.6;
  expect(one.read("strike", 0)!.does).toBe(Math.round(start + ((10_000 - start) * w) / (P.prior_weight + w)));
  close.sawEvent("strike", "close_tie", 6_000);
  expect(gain(close)).toBeGreaterThan(gain(one)); // (a close tie's telling weighs more, as any hearing does)
});

test("the teller's said view is one hearing of approval at the same weight; no view, no hearing; a conduct the person does not hold moves nothing", () => {
  const a = mk(), b = mk(), c = mk();
  const start = a.read("strike", 0)!.approves;
  a.sawEvent("strike", "tie", 6_000, 1_000); // told by one who says it is plainly wrong
  b.sawEvent("strike", "tie", 6_000);
  expect(a.read("strike", 0)!.approves).toBeLessThan(start);
  expect(b.read("strike", 0)!.approves).toBe(start);
  const w = 0.6;
  expect(a.read("strike", 0)!.approves).toBe(Math.round(start + ((1_000 - start) * w) / (CULTURE_DEFAULTS.prior_weight + w + w))); // (the sighting is counted first, as for any act heard with its judgement)
  c.sawEvent("take_in", "tie", 10_000, 1_000); // (not held here: nothing)
  expect(c.has("take_in")).toBe(false);
});

test("no route but the three: an event cannot reach a picture by a register, a directory or a count", () => {
  const c = mk();
  const before = JSON.stringify(c.section(0));
  for (const route of ["register", "directory", "town", "census", "everyone", ""]) expect(() => c.sawEvent("strike", route as any, 10_000, 1_000)).toThrow(/along a tie, by being there, or by what is published/);
  expect(JSON.stringify(c.section(0))).toBe(before);
});

test("only a removal and a walk-out show a conduct a person holds; the words carry the teller's said view and round-trip", () => {
  expect(Object.keys(EVENT_CONDUCTS).sort()).toEqual(["put_out", "strike"]);
  expect(EVENT_KINDS.filter((k) => !EVENT_CONDUCTS[k])).toEqual(["ruling", "law", "vote", "founded"]);
  const t = TOWN_WORDS.say("strike", "works", 5, 6_000, 1, 1_000);
  expect(t).toContain("Of that, I say it is plainly wrong.");
  expect(TOWN_WORDS.heard(`Much the same. ${t} Nothing else.`)).toMatchObject({ kind: "strike", about: "works", hops: 1, says: 1_000 });
  expect(TOWN_WORDS.heard(TOWN_WORDS.say("strike", "works", 5, 6_000, 1))!.says).toBeUndefined();
  expect(TOWN_WORDS.heard(TOWN_WORDS.say("put_out", "police", 5, 6_000, 1, 5_000))!.says).toBe(5_000);
  const m = new TownMemory(dial().params);
  m.saw("strike", "works", 5 * DAY, 6 * DAY);
  expect(m.tell("a", 7 * DAY, () => 3_000)).toContain("I say it is wrong.");
  expect(m.tell("b", 7 * DAY)).not.toContain("Of that");
});

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
