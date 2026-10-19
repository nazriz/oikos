// Culture (docs/behaviour/culture.md; design 14): the numbers a person holds of what those around them do and approve of.
// Arithmetic only: no model, no clock, no draw but a starting lean on the person's own stream.

import { expect, test } from "bun:test";

import { cultureDial, normsRows, type Conduct, type NormsSection } from "../src/shared/culture";
import { RECORD } from "../src/module";
import { DAY, person } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

const dialOf = (more: object = {}) => cultureDial({ dials: { culture: { ...more } } })!;
const RATES: { [c in Conduct]?: number } = { answer_tribunal: 6_000, stay_past_notice: 2_000, take_to_tribunal: 1_500, complain: 3_000, take_in: 5_000, join_union: 3_500, strike: 8_500, take_from_employer: 300 };

/** A townsperson whose record changes are kept as they go to the orchestrator. */
function watched(params: object, dials?: object) {
  const kept = { record: {} as { [section: string]: any } };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); return a; } };
  } };
  return { p: person(module, params, { dials }), kept };
}

test("a person of this dial writes a norms section into their record; with the dial off, none", async () => {
  const dials = { culture: { profile: { conducts: { complain: { does_bps: 2_500, approves_bps: 6_500 } } } } };
  const params = { complain_to: "town", complain_bps: 3_000, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, tribunal: { entity: "tribunal", challenge_bps: 1_500, apply_bps: 800, apply_after_days: 30 }, origin: "north" };
  const on = watched(params, dials), off = watched(params);
  await on.p.wake(DAY);
  await off.p.wake(DAY);
  expect(off.kept.record.norms).toBeUndefined();
  const norms = normsRows(on.kept.record.norms as NormsSection);
  expect(norms.map((x) => x.conduct)).toEqual(["answer_tribunal", "stay_past_notice", "take_to_tribunal", "complain", "take_in", "apply_possession"]);
  const complain = norms.find((x) => x.conduct === "complain")!;
  expect(complain.numbers.slice(0, 2)).toEqual([25, 65]);
  // Nothing else of the record is different.
  const { norms: _n, ...rest } = on.kept.record;
  expect(rest).toEqual(off.kept.record);
});
