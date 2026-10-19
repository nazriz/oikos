// Culture, step 4 (docs/behaviour/culture.md; design 14c): what a tie's act is to me (a tie cools or warms by what I think; I voice what I would
// SAY, which can be other than what I think), what it costs the one who is told it is held against them, pluralistic ignorance and a published count
// that breaks it, a child taking its household's picture and a newcomer arriving with its own and learning the local one, the lean recorded for the
// choices that had no record of it, and the term on a want's way. Arithmetic and a citizen's ears only: no model, no clock.

import { expect, test } from "bun:test";

import { CULTURE_DEFAULTS, cultureDial, type Conduct } from "../src/shared/culture";
import { DECISIONS, RECORD } from "../src/module";
import { DAY, person } from "./stepping";
import { engine } from "./engine";
import { CATCHING_UP, CULTURE_WORDS } from "./phrasing";
const citizen = engine("citizen.default");

const RATES: { [c in Conduct]?: number } = { answer_tribunal: 6_000, complain: 3_000, strike: 8_500, join_union: 3_500, take_in: 5_000 };
const dial = (more: object = {}) => cultureDial({ dials: { culture: { ...more } } })!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- what is said in company

// ---- a citizen's ears and mouth

const from = (who: string, text: string, id = "m1") => ({ id, from: `${who}-self`, t: 0, text });
function watched(params: object, dials?: object, seed = 1n) {
  const kept = { record: {} as { [section: string]: any }, decisions: [] as any[] };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); if (a[DECISIONS]) kept.decisions.push(...a[DECISIONS]); return a; } };
  } };
  return { p: person(module, params, { dials, seed }), kept };
}
const messages = (said: any[]) => said.filter((c) => c.fn === "message").map((c) => ({ to: c.args.to, text: String(c.args.text) }));
const values = Object.fromEntries(["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"].map((v) => [v, 5_000]));
const PARAMS = { own_values: values, complain_to: "town", complain_bps: 3_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, origin: "north" };
// A town whose people hold writing to the town firmly wrong (so most of them, whatever their lean, hold an act of it against a neighbour).
const WRONG = { culture: { profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 300 } }, homophily_bps: 5_000 } } };

test("told by a tie of an act held against it, a citizen cools toward them and says what it makes of it, once; the dial off, none of this", async () => {
  const a = watched(PARAMS, WRONG);
  await a.p.wake(DAY);
  const said = await a.p.wake(2 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] });
  const verdict = messages(said).find((m) => CULTURE_WORDS.verdictHeard(m.text));
  expect(verdict).toBeDefined();
  expect(CULTURE_WORDS.verdictHeard(verdict!.text)!.conduct).toBe("complain");
  expect(verdict!.text).toMatch(/I say it is (plainly )?wrong\.$/);
  expect(verdict!.to).toEqual(["c9-self"]);
  // The tie is cooler: it is in what they keep of c9 (the ties of the record, the few most resented).
  const resented = (a.kept.record.ties?.resented ?? []) as { who: string; affinity: number }[];
  expect(resented.find((x) => x.who === "c9-self")?.affinity ?? 0).toBeLessThan(0);
  // Told the same again later, there is no second verdict from them to the same act: a tie tells it once; a repeat of the words is a second telling and gets its own.
  const off = watched(PARAMS);
  await off.p.wake(DAY);
  const o = await off.p.wake(2 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] });
  expect(messages(o).some((m) => CULTURE_WORDS.verdictHeard(m.text))).toBe(false);
});

test("told what someone says of what it did, a citizen takes a dent in belonging, remembers it, and takes the street to say so", async () => {
  const a = watched(PARAMS, { culture: { profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } } } } });
  await a.p.wake(DAY);
  const ap0 = (a.kept.record.norms as number[][])[3]![1]!;
  await a.p.wake(2 * DAY, { inbox: [from("c9", CULTURE_WORDS.verdict("complain", true, 1_000), "m4")] });
  expect((a.kept.record.norms as number[][])[3]![1]!).toBeLessThan(ap0);
  const mem = JSON.stringify(a.kept.record.memory);
  expect(mem).toContain("disapproved");
});

test("a parent, asked how things are by a child come of age, tells where they come from and how they see it", async () => {
  const a = watched(PARAMS, WRONG);
  await a.p.wake(DAY);
  const said = await a.p.wake(2 * DAY, { inbox: [from("kid", "What matters most to you in life?", "m5")] });
  const texts = messages(said).map((m) => m.text);
  const told = texts.find((t) => CULTURE_WORDS.householdHeard(t).length);
  expect(told).toBeDefined();
  expect(CULTURE_WORDS.fromHeard(told!)).toBe("north");
  expect(CULTURE_WORDS.householdHeard(told!).find((x) => x.conduct === "complain")).toEqual({ conduct: "complain", does: 3_000, approves: 0 });
  // With the dial off, only what matters.
  const off = watched(PARAMS);
  await off.p.wake(DAY);
  const o = await off.p.wake(2 * DAY, { inbox: [from("kid", "What matters most to you in life?", "m5")] });
  expect(messages(o).map((m) => m.text).some((t) => CULTURE_WORDS.householdHeard(t).length)).toBe(false);
});

// ---- children and newcomers

test("a newcomer arrives with the profile's picture, held at weight 1, and is of a group drawn from the profile's shares; what they are told here soon outweighs it", async () => {
  const dials = { culture: { profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } }, homophily_bps: 5_000, origin_shares: [{ id: "north", share_bps: 7_000 }, { id: "south", share_bps: 3_000 }] } } };
  const { origin: _o, own_values: _v, ...params } = PARAMS;
  const groups = new Map<string, number>();
  for (let seed = 1n; seed <= 120n; seed++) {
    const a = watched(params, dials, seed);
    await a.p.wake(DAY);
    const said = await a.p.wake(2 * DAY, { inbox: [from("c9", CATCHING_UP.ask)] });
    const g = messages(said).map((m) => CULTURE_WORDS.fromHeard(m.text)).find(Boolean);
    expect(["north", "south"]).toContain(g!);
    groups.set(g!, (groups.get(g!) ?? 0) + 1);
    if (seed === 1n) expect((a.kept.record.norms as number[][])[3]![4]).toBe(CULTURE_DEFAULTS.newcomer_weight);
  }
  expect(groups.get("north")! / 120).toBeGreaterThan(0.55);
  expect(groups.get("north")! / 120).toBeLessThan(0.85);
  // One told that a tie wrote moves them further than it would move someone the world gave values to (weight 1 against 4).
  const newcomer = watched({ ...params, complain_to: "town" }, dials);
  const settled = watched(PARAMS, dials);
  for (const x of [newcomer, settled]) { await x.p.wake(DAY); await x.p.wake(2 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] }); }
  expect((newcomer.kept.record.norms as number[][])[3]![0]!).toBeGreaterThan((settled.kept.record.norms as number[][])[3]![0]! + 10);
  // Born or come here with a group already given: kept, not drawn again.
  const given = watched({ ...params, origin: "south" }, dials, 2n);
  await given.p.wake(DAY);
  const reply = await given.p.wake(2 * DAY, { inbox: [from("c9", CATCHING_UP.ask)] });
  expect(messages(reply).map((m) => CULTURE_WORDS.fromHeard(m.text)).find(Boolean)).toBe("south");
});

// ---- the lean, recorded

test("the lean is recorded for a vote to strike: the picture it was made from, and the chance it was made at", async () => {
  const params = { ...PARAMS, union: "union", union_join_bps: { other: 3_000 }, strike_vote_yes_bps: 8_500, ballot_turnout_bps: 10_000 };
  const a = watched(params, { culture: {} });
  const { employment, signed, statement } = await import("./stepping");
  const records = [...signed(employment("J1", 0, "firm", "c1", 100_000)), statement("b1", 2 * DAY, "action_ballot", { speaks_for: "union", addressed_to: ["c1"], data: { employer: "firm", closes: 9 * DAY } })];
  await a.p.wake(DAY, { records: records.slice(0, -1), readings: { J1: { of: "agreement", status: "in_force" } } });
  await a.p.wake(3 * DAY, { records, readings: { J1: { of: "agreement", status: "in_force" } } });
  const d = a.kept.decisions.find((x) => x.domain === "strike");
  expect(d).toBeDefined();
  expect(d.norm.conduct).toBe("strike");
  expect(Object.keys(d.norm).sort()).toEqual(["approves", "conduct", "does", "lean", "own", "says"]);
  expect(d.choice === "yes" || d.choice === "no").toBe(true);
  // With the dial off no such decision exists.
  const off = watched(params);
  await off.p.wake(DAY, { records: records.slice(0, -1), readings: { J1: { of: "agreement", status: "in_force" } } });
  await off.p.wake(3 * DAY, { records, readings: { J1: { of: "agreement", status: "in_force" } } });
  expect(off.kept.decisions.some((x) => x.domain === "strike")).toBe(false);
});
