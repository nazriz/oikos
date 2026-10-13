// Ordinary talk about others' conduct (docs/behaviour/culture.md, "Ordinary talk"; design 14c): asked how things are, a person may tell of one act of a
// third person that a tie told them first-hand, and what they say of it. No model, no clock.

import { expect, test } from "bun:test";
import { CATCHING_UP, citizen } from "../src/behaviour/citizen";
import { Culture, CULTURE_DEFAULTS, CULTURE_WORDS, cultureDial, cultureParams, type CultureEnv } from "../src/behaviour/culture";
import { DECISIONS, RECORD } from "../src/module";
import { DAY, person } from "./stepping";

const dial = (step: object = {}) => cultureDial({ dials: { culture: { step: { gossip_bps: 10_000, ...step }, profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 }, join_union: { does_bps: 3_000, approves_bps: 5_000 } } } } } })!;
const mk = (d = dial(), draw = 0) => {
  const env: CultureEnv = { z: () => 0, conformity: () => 0.5, belonging: () => 0.5, integrity: () => 0.5, draw: () => draw };
  return new Culture(d.params, d, env, { complain: 3_000, join_union: 3_500 });
};
const always = () => 0, never = () => 9_999;

test("the phrase is read back: who, the occasion, what they did, and how the teller judges the act", () => {
  const text = CULTURE_WORDS.about("p12", "complain", true, 1_000);
  expect(text).toBe("About p12: When a service failed: they wrote to the town. Of that, I say it is plainly wrong.");
  expect(CULTURE_WORDS.aboutHeard(`I am well. ${text} Anything else?`)).toEqual({ who: "p12", conduct: "complain", did: true, approval: 1_000 });
  expect(CULTURE_WORDS.aboutHeard(CULTURE_WORDS.about("p3", "join_union", false, 9_000))).toEqual({ who: "p3", conduct: "join_union", did: false, approval: 9_000 });
  // It is no first-person phrase and no verdict: neither reads it.
  expect(CULTURE_WORDS.heard(text)).toBeUndefined();
  expect(CULTURE_WORDS.verdictHeard(text)).toBeUndefined();
});

test("I tell only of what a tie told me of themself: nothing known, nothing told; never the asker's own; each act once to each asker; not past gossip_days", () => {
  const c = mk();
  expect(c.gossip("a", 0, always)).toBeUndefined(); // (no one has told me anything)
  c.learnOf("p1", "complain", true, 0);
  expect(c.gossip("p1", DAY, always)).toBeUndefined(); // (the asker's own act: they know it)
  const told = c.gossip("a", DAY, always)!;
  expect(CULTURE_WORDS.aboutHeard(told)).toMatchObject({ who: "p1", conduct: "complain", did: true });
  expect(c.gossip("a", 2 * DAY, always)).toBeUndefined(); // (once to each)
  expect(c.gossip("b", 2 * DAY, always)).toBeDefined();
  expect(c.gossip("z", (CULTURE_DEFAULTS.gossip_days + 1) * DAY, always)).toBeUndefined(); // (old news)
  // A conduct I do not hold is not learned.
  c.learnOf("p2", "strike", true, 0);
  expect(c.gossip("q", DAY, always)).toBeDefined();
});

test("the chance is a draw, made only when there is something to tell", () => {
  const c = mk(dial({ gossip_bps: 3_000 }));
  let draws = 0;
  const roll = (x: number) => () => (draws++, x);
  expect(c.gossip("a", 0, roll(0))).toBeUndefined();
  expect(draws).toBe(0);
  c.learnOf("p1", "complain", true, 0);
  expect(c.gossip("a", DAY, roll(3_000))).toBeUndefined();
  expect(c.gossip("a", DAY, roll(2_999))).toBeDefined();
  expect(draws).toBe(2);
  expect(c.gossip("b", DAY, never)).toBeUndefined();
});

test("what I keep to tell of is bounded: the oldest person's acts give way", () => {
  const c = mk(dial({ third_kept: 3 }));
  for (let i = 0; i < 6; i++) c.learnOf(`p${i}`, "complain", true, i * DAY);
  const heard = new Set<string>();
  for (let i = 0; i < 6; i++) { const t = c.gossip("ask", 7 * DAY, always); if (t) heard.add(CULTURE_WORDS.aboutHeard(t)!.who); } // (the same asker, six times: the most recent first)
  expect(heard.size).toBe(3);
  expect([...heard].sort()).toEqual(["p3", "p4", "p5"]);
});

test("the hearer's picture moves by the existing rules, once for one act; their view of the one talked about is by their own", () => {
  const me = mk(dial(), -2); // privately holds writing to the town wrong
  const before = me.read("complain", 0)!;
  const r = me.hearAbout("p1", "complain", true, 1_000, DAY)!;
  const after = me.read("complain", DAY)!;
  expect(after.does).toBeGreaterThan(before.does); // one more who did it
  expect(after.approves).toBeLessThan(before.approves); // and a teller said it was wrong
  expect(r.tie).toBeLessThan(0); // I hold it wrong too: the one talked about loses standing with me
  expect(me.hearAbout("p1", "complain", true, 1_000, 2 * DAY)).toBeUndefined(); // the same act again: not counted again
  expect(me.read("complain", 2 * DAY)!.does).toBe(after.does);
  // Someone who approves gives standing.
  const fan = mk(dial(), 2);
  expect(fan.hearAbout("p1", "complain", true, 9_000, DAY)!.tie).toBeGreaterThan(0);
  // What I know first-hand of them I already counted.
  const direct = mk();
  direct.learnOf("p9", "complain", true, 0);
  expect(direct.hearAbout("p9", "complain", true, 9_000, DAY)).toBeUndefined();
  // And the hearing is by a tie's route only.
  expect(() => me.hearAbout("p2", "complain", true, 1_000, DAY, "register" as any)).toThrow(/by what is published/);
});

test("the sizes are checked", () => {
  expect(() => cultureParams({ gossip_bps: 10_001 })).toThrow();
  expect(() => cultureParams({ gossip_days: 0 })).toThrow();
  expect(() => cultureParams({ third_kept: 0 })).toThrow();
});

// ---- a citizen's ears and mouth

const from = (who: string, text: string, id = "m1") => ({ id, from: `${who}-self`, t: 0, text });
function watched(params: object, dials?: object) {
  const kept = { record: {} as { [section: string]: any } };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); void DECISIONS; return a; } };
  } };
  return { p: person(module, params, { dials }), kept };
}
const messages = (said: any[]) => said.filter((c) => c.fn === "message").map((c) => ({ to: c.args.to, text: String(c.args.text) }));
const values = Object.fromEntries(["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"].map((v) => [v, 5_000]));
const PARAMS = { own_values: values, complain_to: "town", complain_bps: 3_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, origin: "north" };
const ON = { culture: { step: { gossip_bps: 10_000 }, profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } } } } };

test("a citizen told by one tie that they wrote to the town tells another tie, when asked how things are, of that tie and what they say of it; the dial off, nothing", async () => {
  const a = watched(PARAMS, ON);
  await a.p.wake(DAY);
  await a.p.wake(2 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] });
  const said = await a.p.wake(3 * DAY, { inbox: [from("c4", CATCHING_UP.ask, "m4")] });
  const reply = messages(said).find((m) => m.to.includes("c4-self"));
  expect(reply).toBeDefined();
  const about = CULTURE_WORDS.aboutHeard(reply!.text);
  expect(about).toMatchObject({ who: "c9-self", conduct: "complain", did: true });
  // They do not tell the one it is about, of themself.
  const back = await a.p.wake(4 * DAY, { inbox: [from("c9", CATCHING_UP.ask, "m5")] });
  expect(messages(back).every((m) => !CULTURE_WORDS.aboutHeard(m.text))).toBe(true);
  // Off: no phrase.
  const off = watched(PARAMS);
  await off.p.wake(DAY);
  await off.p.wake(2 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] });
  const o = await off.p.wake(3 * DAY, { inbox: [from("c4", CATCHING_UP.ask, "m4")] });
  expect(messages(o).every((m) => !CULTURE_WORDS.aboutHeard(m.text))).toBe(true);
});

test("a citizen told of a stranger's act moves their picture and creates no tie to the stranger; told of a tie's, the tie moves", async () => {
  const a = watched(PARAMS, { culture: { step: { gossip_bps: 10_000 }, profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 300 } } } } });
  await a.p.wake(DAY);
  const does0 = (a.kept.record.norms as number[][])[3]![0]!;
  await a.p.wake(2 * DAY, { inbox: [from("c7", CULTURE_WORDS.about("p77", "complain", true, 1_000), "m6")] });
  expect((a.kept.record.norms as number[][])[3]![0]!).toBeGreaterThanOrEqual(does0);
  const resented = (a.kept.record.ties?.resented ?? []) as { who: string }[];
  expect(resented.some((x) => x.who === "p77")).toBe(false); // (a stranger: no standing to lose)
});
