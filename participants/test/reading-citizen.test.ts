// Reading at the citizen (docs/behaviour/reading.md; design 13c): what the words of a decision addressed to a person
// were read to be move that person's record, from their own record, through terms the code mind already has. No model:
// the reading is handed in as the orchestrator's desk would file it. A dial that is off, a paper that was not read, and a
// paper read as the plain one all give the figures that were always given; no draw's name changes.

import { expect, test } from "bun:test";

import { NO_SHIFT, shiftOf, NEUTRAL, type PaperRead, type Reading } from "../src/shared/reading";
import { inCurrency } from "../src/money";
import { OUTCOMES, RECORD } from "../src/module";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, person, statement } from "./stepping";
import { DRAWS, engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);
const reading = (respect: number, reason: number, answers: number, recourse: number, threat = 0): Reading => ({ respect, reason, answers, recourse, threat, appeals: NEUTRAL.appeals });
const PLAIN = reading(0, 1, 1, 0);
const HUMANE = reading(1, 2, 2, 2), CURT = reading(-2, 0, 0, 0, 1);

/** A townsperson who is shown `reads` (paper id -> its reading) by a desk, with the dial on (`dial`) or off. */
function watched(o: { dial: boolean; reads?: { [paper: string]: Reading | "none" }; seed?: bigint; params?: object }) {
  const kept = { record: {} as { [s: string]: any }, outcomes: [] as any[], draws: [] as string[] };
  const module = { create: (ctx: any) => {
    if (o.dial) ctx.world = { ...ctx.world, dials: { reading: { reader: "mock" } } };
    if (o.reads) ctx.read = (paper: string, standing: string): PaperRead | undefined => {
      const r = o.reads![paper];
      return r && r !== "none" ? { paper, standing: standing as any, shift: shiftOf(r, PLAIN), source: "model" } : r === "none" ? { paper, standing: standing as any, shift: NO_SHIFT, source: "table" } : undefined;
    };
    const m = citizen.create(ctx);
    return { step: async (ob: any, c: any) => {
      const a: any = await m.step(ob, c);
      if (a[RECORD]) Object.assign(kept.record, a[RECORD].set);
      kept.outcomes.push(...(a[OUTCOMES] ?? []));
      kept.draws.push(...(a[DRAWS] ?? []));
      return a;
    } };
  } };
  return { p: person(module, o.params ?? {}, { seed: o.seed ?? 1n }), kept };
}
const answer = (id: string, at: number, granted: boolean, to = "c1") => statement(id, at, "variation_answer", { author: "landlord-1-office-system", speaks_for: "landlord-1", addressed_to: [to], visible_to: ["landlord-1", to], text: `Answer to your request: ${granted}.`,
  data: { about: "inc-1", granted, reason: "words that were written" } });
const trust = (x: { kept: any }) => x.kept.record.trust?.in.find((t: any) => t.in === "landlord-1")?.bps as number;
const agency = (x: { kept: any }) => x.kept.record.agency?.now as number;

async function refused(o: Parameters<typeof watched>[0]) {
  const x = watched(o);
  await x.p.wake(DAY, {});
  await x.p.wake(5 * DAY, { records: [answer("va-1", 4 * DAY, false)] });
  return x;
}

test("a refusal put kindly costs less trust and less sense of agency than the plain refusal, and one put curtly costs more; the same decision, the same person", async () => {
  const off = await refused({ dial: false });
  const plain = await refused({ dial: true, reads: { "va-1": PLAIN } });
  const humane = await refused({ dial: true, reads: { "va-1": HUMANE } });
  const curt = await refused({ dial: true, reads: { "va-1": CURT } });
  // A paper read as the plain one is the plain paper: the figures are the dial-off figures to the digit.
  expect(trust(plain)).toBe(trust(off));
  expect(agency(plain)).toBe(agency(off));
  expect(trust(humane)).toBeGreaterThan(trust(off));
  expect(trust(curt)).toBeLessThan(trust(off));
  expect(agency(humane)).toBeGreaterThan(agency(off));
  expect(agency(curt)).toBeLessThan(agency(off));
  // Words scale what the decision did; they never reverse it: even the kindest refusal left trust lower than it was.
  const kind = humane.kept.outcomes.find((o) => o.read).read.moved;
  expect(kind.trust.after).toBeLessThan(kind.trust.before);
  expect(kind.agency.after).toBeLessThan(kind.agency.before);
  expect(trust(humane)).toBeGreaterThan(trust(curt));
  // The person's side is theirs: the outcome says what the words did, and what each figure would have been without them.
  const read = curt.kept.outcomes.find((o) => o.read);
  expect(read.read.paper).toBe("va-1");
  expect(read.read.shift.respect).toBe(-2);
  expect(read.read.moved.trust.after).toBeLessThan(read.read.moved.trust.plain);
  expect(read.read.moved.trust.plain).toBe(trust(off));
  expect(read.read.moved.anger.after).toBeGreaterThan(read.read.moved.anger.plain);
  expect(read.read.moved.fear.after).toBeGreaterThan(0);
  expect(read.read.moved.tie.after).toBeLessThan(read.read.moved.tie.plain);
  // And the plain paper has no `read` at all.
  expect(plain.kept.outcomes.some((o) => o.read)).toBe(false);
});

test("a grant put warmly counts for a little more, put grudgingly a little less; never the other way", async () => {
  const run = async (r: Reading | undefined) => {
    const x = watched({ dial: true, ...(r ? { reads: { "va-1": r } } : {}) });
    await x.p.wake(DAY, {});
    await x.p.wake(5 * DAY, { records: [answer("va-1", 4 * DAY, true)] });
    return x;
  };
  const none = await run(undefined);
  const warm = await run(reading(2, 1, 1, 0)), grudging = await run(reading(-2, 1, 1, 0));
  expect(trust(warm)).toBeGreaterThan(trust(none));
  expect(trust(grudging)).toBeLessThan(trust(none));
  expect(trust(grudging)).toBeGreaterThan(trust(await refused({ dial: false })));
});

test("the dial off, a reader's answer to nothing, or a desk absent: the person is as they always were, and no draw is added, moved or renamed", async () => {
  const base = await refused({ dial: false });
  const desk = await refused({ dial: true, reads: { "other-paper": HUMANE } }); // (a desk that read some other paper)
  const noDesk = await refused({ dial: true });
  const offWithDesk = await refused({ dial: false, reads: { "va-1": CURT } }); // (the dial is the world's: off, a desk is never asked)
  for (const x of [desk, noDesk, offWithDesk]) {
    expect(x.kept.record).toEqual(base.kept.record);
    expect(x.kept.outcomes).toEqual(base.kept.outcomes);
  }
  // The draws a read paper makes are the draws the plain paper makes, by name and number.
  const curt = await refused({ dial: true, reads: { "va-1": CURT } });
  expect(curt.kept.draws).toEqual(base.kept.draws);
  expect(trust(curt)).not.toBe(trust(base));
});

// ("The odds of appealing follow the recourse a refusal gave" is arithmetic, held by the engine's own test: kernel/crates/actors/src/mind/reading.rs,
// a_step_of_recourse_is_five_hundred_on_the_score_of_asking_again; "the same draw is made" is the third case above.)
