// Learning what others do (docs/behaviour/culture.md; design 14b, 14c): a person's picture moves only along a tie, by being
// there, or by what is published; by the weights and the rule the doc gives; replayed exactly. Arithmetic and a citizen's
// ears only: no model, no clock.

import { expect, test } from "bun:test";
import { CATCHING_UP, citizen } from "../src/behaviour/citizen";
import { Culture, CULTURE_DEFAULTS, CULTURE_WORDS, cultureDial, normsRows, ROUTES, standardNormal, type Conduct, type CultureEnv } from "../src/behaviour/culture";
import { VALUES } from "../src/behaviour/mind";
import { RECORD } from "../src/module";
import { Randomness } from "../src/rng";
import { DAY, person, statement } from "./stepping";

const RATES: { [c in Conduct]?: number } = { answer_tribunal: 6_000, complain: 3_000, strike: 8_500, join_union: 3_500 };
const dial = (more: object = {}) => cultureDial({ dials: { culture: { ...more } } })!;
const mk = (i: number, d = dial(), integrity = 0.5, group?: string) => {
  const env: CultureEnv = { z: () => 0, conformity: () => 0.5, belonging: () => 0.5, integrity: () => integrity, draw: (c) => standardNormal(new Randomness(3n).stream([`q${i}`, c])) };
  return new Culture(d.params, d, env, RATES, group, 0);
};

test("a picture is moved only by a tie, a presence or a publication: any other route is refused", () => {
  const c = mk(1);
  expect(ROUTES).toEqual(["tie", "close_tie", "here", "published"]);
  const before = JSON.stringify(c.section(0));
  for (const route of ["register", "directory", "town", "census", "everyone", ""]) {
    expect(() => c.seeAct("complain", true, route as any)).toThrow(/along a tie, by being there, or by what is published/);
    expect(() => c.seeShare("strike", 9_000, route as any)).toThrow(/published/);
    expect(() => c.hearSaid("complain", 9_000, route as any)).toThrow(/published/);
  }
  expect(JSON.stringify(c.section(0))).toBe(before);
  // The weights are the doc's: a known person 1, a close tie 2, a published count 4.
  expect([c.weight("tie"), c.weight("here"), c.weight("close_tie"), c.weight("published")]).toEqual([1, 1, 2, 4]);
});

test("a ring of twenty, by hand: each hears its two neighbours' acts each round, and does moves as the arithmetic says", () => {
  const N = 20, P = CULTURE_DEFAULTS;
  const ring = Array.from({ length: N }, (_, i) => mk(i));
  const did = (i: number) => i % 3 === 0; // what each did at the occasion
  // The reference, written out independently: weight held n, and does in basis points, rounded at each step.
  const ref = Array.from({ length: N }, () => ({ does: 3_000, n: P.prior_weight }));
  for (const c of ring) expect(c.read("complain", 0)!.does).toBe(3_000);
  for (let round = 0; round < 15; round++) for (let i = 0; i < N; i++) for (const j of [(i + 1) % N, (i + N - 1) % N]) {
    ring[i]!.seeAct("complain", did(j), "tie");
    const r = ref[i]!, n = Math.min(P.window, r.n + 1);
    r.does = Math.max(0, Math.min(10_000, Math.round(r.does + ((did(j) ? 10_000 : 0) - r.does) / n)));
    r.n = n;
  }
  for (let i = 0; i < N; i++) { const got = ring[i]!.read("complain", 0)!; expect(got.does).toBe(ref[i]!.does); expect(got.n).toBe(ref[i]!.n); }
  // The window holds the weight; and people with different neighbours hold different pictures (pictures are local).
  for (const c of ring) expect(c.read("complain", 0)!.n).toBe(P.window);
  expect(new Set(ring.map((c) => c.read("complain", 0)!.does)).size).toBeGreaterThan(1);
  // Replay exact.
  const again = Array.from({ length: N }, (_, i) => mk(i));
  for (let round = 0; round < 15; round++) for (let i = 0; i < N; i++) for (const j of [(i + 1) % N, (i + N - 1) % N]) again[i]!.seeAct("complain", did(j), "tie");
  expect(JSON.stringify(again.map((c) => c.section(0)))).toBe(JSON.stringify(ring.map((c) => c.section(0))));
});

test("a published count moves does by its share at up to its weight; what is said moves approves; both bounded", () => {
  const c = mk(2);
  const n0 = c.read("strike", 0)!;
  c.seeShare("strike", 2_000);
  const r = c.read("strike", 0)!;
  expect(r.n).toBe(Math.min(CULTURE_DEFAULTS.window, n0.n + 4));
  expect(r.does).toBe(Math.round(8_500 + ((2_000 - 8_500) * 4) / (n0.n + 4)));
  const a0 = c.read("strike", 0)!.approves;
  c.hearSaid("strike", 1_000, "tie");
  expect(c.read("strike", 0)!.approves).toBe(Math.round(a0 + ((1_000 - a0) * 1) / (r.n + 1)));
  for (let i = 0; i < 500; i++) { c.seeShare("strike", 0); c.hearSaid("strike", 0, "published"); }
  expect(c.read("strike", 0)!.does).toBeGreaterThanOrEqual(0);
  expect(c.read("strike", 0)!.approves).toBeGreaterThanOrEqual(0);
});

test("telling: each act once to each person who asks, the recent only, what sits ill with what is approved kept back unless integrity is high", () => {
  const c = mk(3, dial({ profile: { conducts: { complain: { approves_bps: 1_000 }, strike: { approves_bps: 9_000 } } } }), 0.1);
  c.act("complain", true, 10 * DAY); // did what they take to be disapproved: kept back
  c.act("strike", true, 11 * DAY);
  const first = c.tell("a", 12 * DAY, 90);
  expect(first.join(" ")).toContain(CULTURE_WORDS.did("strike", true));
  expect(first.join(" ")).not.toContain(CULTURE_WORDS.did("complain", true));
  expect(first.some((x) => x.startsWith("I say"))).toBe(true); // (what they say of it is told)
  expect(c.tell("a", 13 * DAY, 90).join(" ")).not.toContain(CULTURE_WORDS.did("strike", true)); // not twice to the same person
  expect(c.tell("b", 13 * DAY, 90).join(" ")).toContain(CULTURE_WORDS.did("strike", true)); // but once to each
  expect(c.tell("c", 200 * DAY, 90)).toEqual([]); // too long ago
  // High integrity tells what sits ill.
  const bold = mk(4, dial({ profile: { conducts: { complain: { approves_bps: 1_000 } } } }), 0.95);
  bold.act("complain", true, 10 * DAY);
  expect(bold.tell("a", 11 * DAY, 90).join(" ")).toContain(CULTURE_WORDS.did("complain", true));
  // The words round-trip.
  expect(CULTURE_WORDS.heard(CULTURE_WORDS.did("strike", false))).toEqual({ did: [{ conduct: "strike", did: false }], says: [] });
  expect(CULTURE_WORDS.heard(CULTURE_WORDS.says("complain", 3_100))!.says).toEqual([{ conduct: "complain", bps: 3_000 }]);
  expect(CULTURE_WORDS.fromHeard(CULTURE_WORDS.from("north"))).toBe("north");
});

// ---- a citizen's ears
const from = (who: string, text: string, id = "m1") => ({ id, from: `${who}-self`, t: 0, text });
function watched(params: object, dials?: object) {
  const kept = { record: {} as { [section: string]: any }, said: [] as any[] };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); return a; } };
  } };
  return { p: person(module, params, { dials }), kept };
}
const PARAMS = { complain_to: "town", complain_bps: 3_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, origin: "north" };
const DIALS = { culture: { profile: { conducts: { complain: { does_bps: 3_000, approves_bps: 5_000 } }, homophily_bps: 6_000 } } };
const valueOf = (kept: any, conduct: string, k: number) => normsRows(kept.record.norms).find((x) => x.conduct === conduct)!.numbers[k] as number;

test("a citizen's picture moves from what a tie told it; an unrelated line, or a word that is not in the phrasing, moves nothing", async () => {
  const a = watched(PARAMS, DIALS.culture ? DIALS : undefined);
  await a.p.wake(DAY);
  const d0 = valueOf(a.kept, "complain", 0);
  await a.p.wake(2 * DAY, { inbox: [from("c9", "Much the same.")] });
  await a.p.wake(3 * DAY, { inbox: [from("c9", "Everyone in this town writes in, whatever happens.", "m2")] });
  expect(valueOf(a.kept, "complain", 0)).toBe(d0);
  // A tie says it wrote. This person was made in the run (no values of their own given: a newcomer), so holds their picture at weight 1 (step 4):
  // does moves up from 30 by (10000-3000)/2 = 3500 bps => 65%. (One whose world gave them values holds it at weight 4: 44%; tested below.)
  await a.p.wake(4 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] });
  expect(valueOf(a.kept, "complain", 0)).toBe(65);
  // And what they say of it moves approves.
  const ap0 = valueOf(a.kept, "complain", 1);
  await a.p.wake(5 * DAY, { inbox: [from("c9", CULTURE_WORDS.says("complain", 1_000), "m4")] });
  expect(valueOf(a.kept, "complain", 1)).toBeLessThan(ap0);
  // The same lines with the dial off: nothing is held, nothing moves, no section.
  const off = watched(PARAMS);
  await off.p.wake(DAY);
  await off.p.wake(4 * DAY, { inbox: [from("c9", CULTURE_WORDS.did("complain", true), "m3")] });
  expect(off.kept.record.norms).toBeUndefined();
});

test("a citizen says where it comes from when asked how things are, only where the profile gives a homophily; and keeps those of its own group closer", async () => {
  const a = watched(PARAMS, DIALS);
  await a.p.wake(DAY);
  const said = await a.p.wake(2 * DAY, { inbox: [from("c9", CATCHING_UP.ask)] });
  const reply = said.filter((c) => c.fn === "message").map((c) => String(c.args.text)).join(" ");
  expect(reply).toContain(CULTURE_WORDS.from("north"));
  const none = watched(PARAMS, { culture: { profile: { conducts: {} } } });
  await none.p.wake(DAY);
  const q = await none.p.wake(2 * DAY, { inbox: [from("c9", CATCHING_UP.ask)] });
  expect(q.filter((c) => c.fn === "message").map((c) => String(c.args.text)).join(" ")).not.toContain("I come from");
  const off = watched(PARAMS);
  await off.p.wake(DAY);
  const o = await off.p.wake(2 * DAY, { inbox: [from("c9", CATCHING_UP.ask)] });
  expect(o.filter((c) => c.fn === "message").map((c) => String(c.args.text)).join(" ")).not.toContain("I come from");
});

test("a declared ballot result sent to a member is a published count: it moves does for strike once, and a result about no workplace moves nothing", async () => {
  const params = { union: "union", union_join_bps: { other: 3_000 }, strike_vote_yes_bps: 8_500, ballot_turnout_bps: 7_000 };
  const a = watched(params, { culture: {} });
  await a.p.wake(DAY);
  const d0 = valueOf(a.kept, "strike", 0);
  const result = (id: string, extra: object) => statement(id, 2 * DAY, "ballot_result", { speaks_for: "union", addressed_to: ["c1"], data: { ballot: "b1", voted: 10, yes: 2, ...extra } });
  await a.p.wake(3 * DAY, { records: [result("r1", { employer: "factory-1" })] });
  const d1 = valueOf(a.kept, "strike", 0);
  expect(d1).toBeLessThan(d0);
  await a.p.wake(4 * DAY, { records: [result("r1", { employer: "factory-1" })] });
  expect(valueOf(a.kept, "strike", 0)).toBe(d1); // once
  await a.p.wake(5 * DAY, { records: [result("r2", {})] }); // (a council's, no employer)
  expect(valueOf(a.kept, "strike", 0)).toBe(d1);
});
