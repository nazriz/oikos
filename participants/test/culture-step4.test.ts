// Culture, step 4 (docs/behaviour/culture.md; design 14c): what a tie's act is to me (a tie cools or warms by what I think; I voice what I would
// SAY, which can be other than what I think), what it costs the one who is told it is held against them, pluralistic ignorance and a published count
// that breaks it, a child taking its household's picture and a newcomer arriving with its own and learning the local one, the lean recorded for the
// choices that had no record of it, and the term on a want's way. Arithmetic and a citizen's ears only: no model, no clock.

import { expect, test } from "bun:test";
import { CATCHING_UP, citizen } from "../src/behaviour/citizen";
import { Culture, CULTURE_DEFAULTS, CULTURE_WORDS, cultureDial, standardNormal, type Conduct, type CultureEnv } from "../src/behaviour/culture";
import { DECISIONS, RECORD } from "../src/module";
import { Randomness } from "../src/rng";
import { DAY, person } from "./stepping";

const RATES: { [c in Conduct]?: number } = { answer_tribunal: 6_000, complain: 3_000, strike: 8_500, join_union: 3_500, take_in: 5_000 };
const dial = (more: object = {}) => cultureDial({ dials: { culture: { ...more } } })!;
/** A person with their own lean fixed (`draw`, in standard deviations of their own lean) and how much they belong, conform and keep to their own mind. */
const mk = (o: { draw?: number; conformity?: number; belonging?: number; integrity?: number; d?: ReturnType<typeof dial>; group?: string } = {}) => {
  const d = o.d ?? dial();
  const env: CultureEnv = { z: () => 0, conformity: () => o.conformity ?? 0.5, belonging: () => o.belonging ?? 0.5, integrity: () => o.integrity ?? 0.5, draw: () => o.draw ?? 0 };
  return new Culture(d.params, d, env, RATES, o.group, 0);
};

// ---- said and thought

test("a person may voice approval of what they privately doubt, and cool toward the one who did it while they say so", () => {
  // The street is taken to approve (8,000); this person privately holds it wrong (own about 2,000); belonging weighs, integrity does not.
  const d = dial({ profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 8_000 } } } });
  const c = mk({ d, draw: -4, belonging: 0.9, integrity: 0.1 });
  const r = c.read("complain", 0)!;
  expect(r.own).toBeLessThan(2_500);
  expect(r.says).toBeGreaterThan(7_500); // what they say is what they take the street to say
  const reaction = c.react("complain", true, 0)!;
  expect(reaction.tie).toBeLessThan(0); // privately, it is held against them
  expect(reaction.voice).toBeGreaterThan(7_500); // aloud, it is approved
  expect(CULTURE_WORDS.verdict("complain", true, reaction.voice!)).toMatch(/I say it is (plainly )?right\.$/);
  // Someone of integrity says what they think.
  const frank = mk({ d, draw: -4, belonging: 0.9, integrity: 0.99 });
  expect(frank.react("complain", true, 0)!.voice).toBeLessThan(2_500);
});

test("a tie cools only by more than the margin, in proportion, and warms toward what is held with; a doubt about not doing it is the other way round", () => {
  const d = dial({ profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } } } });
  expect(mk({ d, draw: 0 }).react("complain", true, 0)).toBeUndefined(); // (nothing to feel, nothing to say: in the middle)
  const against = mk({ d, draw: -3 }).react("complain", true, 0)!; // own 500: held against
  const worse = mk({ d, draw: -3.3 }).react("complain", true, 0)!;
  expect(against.tie).toBeLessThan(0);
  expect(Math.abs(against.tie)).toBeLessThanOrEqual(CULTURE_DEFAULTS.cool_bps);
  expect(worse.tie).toBeLessThanOrEqual(against.tie);
  const warm = mk({ d, draw: 3 }).react("complain", true, 0)!;
  expect(warm.tie).toBeGreaterThan(0);
  expect(warm.tie).toBeLessThanOrEqual(CULTURE_DEFAULTS.esteem_bps);
  // The same person, told that the other did NOT do it: what they hold right, they hold against not doing.
  expect(mk({ d, draw: 3 }).react("complain", false, 0)!.tie).toBeLessThan(0);
});

test("being told it is held against you dents belonging, more for a conformist, and moves what you take to be approved", () => {
  const d = dial({ profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } } } });
  const conformist = mk({ d, conformity: 1 }), loner = mk({ d, conformity: 0 });
  const a0 = conformist.read("complain", 0)!.approves;
  const dent = conformist.judged("complain", true, 1_000, "tie");
  const small = loner.judged("complain", true, 1_000, "tie");
  expect(dent).toBeGreaterThan(small);
  expect(dent).toBeLessThanOrEqual(Math.round(CULTURE_DEFAULTS.disapproved_bps * 1.5));
  expect(small).toBeGreaterThan(0);
  expect(conformist.read("complain", 0)!.approves).toBeLessThan(a0); // they said it is wrong: so it is taken to be
  // Approved: no dent; and approves moves up.
  const b0 = conformist.read("complain", 0)!.approves;
  expect(conformist.judged("complain", true, 9_000, "close_tie")).toBe(0);
  expect(conformist.read("complain", 0)!.approves).toBeGreaterThan(b0);
  // A verdict of not doing it is read the other way: "wrong to not do it" is approval of doing it.
  const e = mk({ d });
  const e0 = e.read("complain", 0)!.approves;
  e.judged("complain", false, 1_000, "tie");
  expect(e.read("complain", 0)!.approves).toBeGreaterThan(e0);
});

test("the words round-trip: a verdict, and what a parent tells a child", () => {
  for (const c of ["answer_tribunal", "complain", "take_in", "strike", "take_from_employer"] as Conduct[]) for (const did of [true, false]) for (const bps of [1_000, 3_000, 7_000, 9_000]) {
    const t = CULTURE_WORDS.verdict(c, did, bps);
    expect(CULTURE_WORDS.verdictHeard(t)).toEqual({ conduct: c, did, approval: bps });
    expect(CULTURE_WORDS.heard(t)).toBeUndefined(); // (it is not taken for a telling of one's own act or opinion)
  }
  expect(CULTURE_WORDS.verdictHeard("Of course I say it is right.")).toBeUndefined();
  const h = CULTURE_WORDS.household("complain", 3_000, 6_000) + " " + CULTURE_WORDS.household("take_in", 5_000, 4_000);
  expect(CULTURE_WORDS.householdHeard(h)).toEqual([{ conduct: "complain", does: 3_000, approves: 6_000 }, { conduct: "take_in", does: 5_000, approves: 4_000 }]);
});

// ---- pluralistic ignorance

/** A street of twelve who privately approve (own about 6,500), take the street to disapprove (approves 2,000), belong and do not keep to their own mind: so each says "wrong". */
function street(): Culture[] {
  const d = dial({ profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 2_000 } } } });
  return Array.from({ length: 12 }, () => mk({ d, draw: 3, belonging: 0.8, integrity: 0.2, conformity: 0.8 }));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const gap = (s: Culture[], t: number) => mean(s.map((c) => c.read("complain", t)!.own)) - mean(s.map((c) => c.read("complain", t)!.approves));

test("pluralistic ignorance: each privately approves, each says it is wrong, and the street goes on taking itself to disapprove; saying it to each other does not undo it", () => {
  const s = street();
  for (const c of s) {
    const r = c.read("complain", 0)!;
    expect(r.own).toBeGreaterThanOrEqual(6_500); // thought: right
    expect(r.says).toBeLessThan(3_500); // said: wrong
  }
  const g0 = gap(s, 0);
  expect(g0).toBeGreaterThan(4_000);
  // Thirty rounds of everyone telling the next what they say of it: they hear "wrong", and take the street to say so.
  for (let round = 0; round < 30; round++) for (let i = 0; i < s.length; i++) s[(i + 1) % s.length]!.hearSaid("complain", s[i]!.read("complain", 0)!.says, "tie");
  expect(gap(s, 0)).toBeGreaterThan(g0 - 600); // (nothing said among them moved it: they only ever heard what they themselves had said)
  for (const c of s) expect(c.read("complain", 0)!.says).toBeLessThan(3_500);
});

test("a count taken in secret and published breaks it: the street learns what each thought, and says so", () => {
  const quiet = street(), told = street();
  const g0 = gap(told, 0);
  // A count of how many would approve, taken in secret and published: seven in ten. Everyone reads it.
  for (let reading = 0; reading < 3; reading++) for (const c of told) c.hearSaid("complain", 7_000, "published");
  expect(gap(told, 0)).toBeLessThan(g0 / 3); // what they take the street to approve has moved to near what each thought
  for (const c of told) expect(c.read("complain", 0)!.says).toBeGreaterThan(5_000); // and now they say it is right
  // Without the count, the same days leave the street as it was.
  expect(gap(quiet, 100 * DAY)).toBeGreaterThan(g0 - 400); // (own settles slowly toward what is approved: a hundred days of that, and nothing else)
  expect(gap(quiet, 100 * DAY)).toBeGreaterThan(gap(told, 100 * DAY) + 2_000);
  // And they no longer voice disapproval of someone who did it, where before they did.
  expect(told[0]!.react("complain", true, 0)?.voice ?? 5_000).toBeGreaterThanOrEqual(5_000);
  expect(quiet[0]!.react("complain", true, 0)!.voice).toBeLessThan(2_500);
});

// ---- what is said in company

test("what I think of what I was told of, I say to those who ask, once to each, when it is lately in the news", () => {
  const d = dial({ profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } } } });
  const c = mk({ d, draw: 3, integrity: 0.9 });
  expect(c.tell("a", 0, 90)).toEqual([]);
  c.noteHeard("complain", 10 * DAY);
  const first = c.tell("a", 11 * DAY, 90);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatch(/^I say writing to the town about a service is (right|plainly right)\.$/);
  expect(c.tell("a", 12 * DAY, 90)).toEqual([]); // not twice to the same
  expect(c.tell("b", 12 * DAY, 90)).toHaveLength(1);
  expect(c.tell("c", 300 * DAY, 90)).toEqual([]); // not in the news now
  // Someone with no opinion either way says nothing.
  const flat = mk({ d, draw: 0 });
  flat.noteHeard("complain", 10 * DAY);
  expect(flat.tell("a", 11 * DAY, 90)).toEqual([]);
});

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

test("a child coming of age takes the mean of its parents' pictures at the prior's weight, and their group; a conduct no parent spoke of keeps its own", () => {
  const d = dial({ profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 }, strike: { does_bps: 8_500, approves_bps: 5_000 } }, by_origin: { east: { strike: { does_bps: 2_000 } } } } });
  const child = mk({ d, draw: 1 });
  child.arrive(0);
  expect(child.read("complain", 0)!.n).toBe(CULTURE_DEFAULTS.newcomer_weight);
  const own0 = child.read("complain", 0)!.own;
  const taken = child.adoptHousehold([
    [{ conduct: "complain", does: 2_000, approves: 3_000 }],
    [{ conduct: "complain", does: 4_000, approves: 5_000 }],
  ], 100 * DAY);
  expect([...taken]).toEqual(["complain"]);
  const r = child.read("complain", 100 * DAY)!;
  expect(r.does).toBe(3_000);
  expect(r.approves).toBe(4_000);
  expect(r.n).toBe(CULTURE_DEFAULTS.prior_weight);
  expect(r.own).not.toBe(own0); // (their own lean restarts from the picture they were given)
  child.setGroup("east", taken);
  expect(child.group).toBe("east");
  expect(child.read("strike", 100 * DAY)!.does).toBe(2_000); // a group's figure is where one starts, where the household said nothing
  expect(child.read("complain", 100 * DAY)!.does).toBe(3_000); // (and does not undo what a household said)
});

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

test("the standard normal and the starting lean are untouched by step 4: the same person has the same lean", () => {
  const draw = (c: Conduct) => standardNormal(new Randomness(3n).stream(["q1", c]));
  const d = dial();
  const env: CultureEnv = { z: () => 0, conformity: () => 0.5, belonging: () => 0.5, integrity: () => 0.5, draw };
  const a = new Culture(d.params, d, env, RATES, undefined, 0), b = new Culture(d.params, d, env, RATES, undefined, 0);
  for (const c of a.held) expect(a.read(c, 0)).toEqual(b.read(c, 0));
});
