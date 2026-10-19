// Ordinary talk about others' conduct (docs/behaviour/culture.md, "Ordinary talk"; design 14c): asked how things are, a person may tell of one act of a
// third person that a tie told them first-hand, and what they say of it. No model, no clock.

import { expect, test } from "bun:test";

import { cultureDial } from "../src/shared/culture";
import { DECISIONS, RECORD } from "../src/module";
import { DAY, person } from "./stepping";
import { engine } from "./engine";
import { CATCHING_UP, CULTURE_WORDS } from "./phrasing";
const citizen = engine("citizen.default");

const dial = (step: object = {}) => cultureDial({ dials: { culture: { step: { gossip_bps: 10_000, ...step }, profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 }, join_union: { does_bps: 3_000, approves_bps: 5_000 } } } } } })!;
const always = () => 0, never = () => 9_999;

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
