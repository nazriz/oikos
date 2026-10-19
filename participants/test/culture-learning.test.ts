// Learning what others do (docs/behaviour/culture.md; design 14b, 14c): a person's picture moves only along a tie, by being
// there, or by what is published; by the weights and the rule the doc gives; replayed exactly. Arithmetic and a citizen's
// ears only: no model, no clock.

import { expect, test } from "bun:test";

import { cultureDial, normsRows, type Conduct } from "../src/shared/culture";
import { RECORD } from "../src/module";
import { DAY, person, statement } from "./stepping";
import { engine } from "./engine";
import { CATCHING_UP, CULTURE_WORDS } from "./phrasing";
const citizen = engine("citizen.default");

const RATES: { [c in Conduct]?: number } = { answer_tribunal: 6_000, complain: 3_000, strike: 8_500, join_union: 3_500 };
const dial = (more: object = {}) => cultureDial({ dials: { culture: { ...more } } })!;

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
