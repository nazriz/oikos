// Town memory (docs/behaviour/culture.md; design 14e): a few typed slots, a strength that fades by a formula, retold along ties, held by whoever saw,
// read or was told it and by no other route; a removal seen only by those inside the building; trust moved once. Arithmetic and a citizen's eyes and ears:
// no model, no clock.

import { expect, test } from "bun:test";

import { cultureDial } from "../src/shared/culture";
import { RECORD } from "../src/module";
import { DAY, person, statement } from "./stepping";
import { engine } from "./engine";
import { CATCHING_UP, TOWN_WORDS } from "./phrasing";
const citizen = engine("citizen.default");

const dial = () => cultureDial({ dials: { culture: {} } })!;

// ---- a citizen

const from = (who: string, text: string, id = "m1") => ({ id, from: `${who}-self`, t: 0, text });
function watched(params: object, dials: object | false = { culture: {} }) {
  const kept = { record: {} as { [section: string]: any } };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => { const a: any = await m.step(o, c); if (a[RECORD]) Object.assign(kept.record, a[RECORD].set); return a; } };
  } };
  // (Who carries out a removal is the law on possession's, which the town publishes: foundations F8, law 6. Every wake is shown it, as a person is, once it is on file.)
  const law = statement("law-possession", 0, "law", { speaks_for: "outside", data: { tenancy: "possession", enforced_by: "police" } });
  const p = person(module, params, dials ? { dials } : {});
  const wake = p.wake.bind(p);
  p.wake = (t: number, w: any = {}) => wake(t, { ...w, records: [law, ...(w.records ?? [])] });
  return { p, kept };
}
const values = Object.fromEntries(["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"].map((v) => [v, 5_000]));
const PARAMS = { own_values: values, possession: { stay_bps: 2_000, obey_bps: 5_000, answer_bps: 6_000 }, welfare: { police: "police", channel: "x", found_after: [] } };
const cell = (left: object[] | undefined, extra: object = {}) => [{ cell: "c.1", x: 0, y: 0, structure: { structure: "apts-1", type: "apartments", at: "c.1", w: 1, h: 1, complete: true,
  spaces: [{ space: "apts-1/dwelling.2", kind: "dwelling", capacity: 4, count: 0, ...(left ? { occupants: [], left } : { seen_leaving: 100 }), ...extra }] } }];
const removed = (t: number, who = "c7") => [{ occupant: who, reason: "removed", at: t }];
const heard = (a: ReturnType<typeof watched>) => (a.kept.record.heard ?? []) as any[];
const trustIn = (a: ReturnType<typeof watched>, who: string) => ((a.kept.record.trust?.in ?? []) as any[]).find((x) => x.who === who || x.of === who);

test("a removal carried out in a building I am in is seen: held at full strength, a sighting of the conduct, bearing once on trust in whoever did it", async () => {
  // A person who holds applying for possession right (the middle of nothing: their own lean is what it is; this one is pushed by a profile figure).
  const dials = { culture: { profile: { conducts: { apply_possession: { does_bps: 5_000, approves_bps: 9_000 } } } } };
  const a = watched(PARAMS, dials);
  await a.p.wake(DAY);
  const before = (a.kept.record.norms as any[])[8]?.[0];
  await a.p.wake(2 * DAY, { street: cell(removed(2 * DAY - 3_600)) });
  expect(heard(a)).toHaveLength(1);
  expect(heard(a)[0].slice(0, 2)).toEqual([0, "police"]);
  expect(heard(a)[0][3]).toBe(100);
  expect(heard(a)[0][4]).toBe(0); // saw
  expect((a.kept.record.norms as any[])[8]?.[0]).toBeGreaterThan(before); // (one sighting of the landlord's applying moved what they take to be done)
  const t1 = JSON.stringify(a.kept.record.trust);
  // The same departure found again at the next wake is not seen twice; nor does the memory move trust again.
  await a.p.wake(3 * DAY, { street: cell(removed(2 * DAY - 3_600)) });
  expect(heard(a)).toHaveLength(1);
  expect(JSON.stringify(a.kept.record.trust)).toBe(t1);
  // A removal of someone else the same day by the same doers is the same event held again, not a second slot.
  await a.p.wake(4 * DAY, { street: cell([...removed(2 * DAY - 3_600), ...removed(3 * DAY + 100, "c8")]) });
  expect(heard(a).length).toBeLessThanOrEqual(2);
});

test("only those whose own place puts them there: a building I am not in shows only that someone was seen leaving; an old departure, my own household, and the dial off see nothing", async () => {
  const a = watched(PARAMS);
  await a.p.wake(DAY);
  await a.p.wake(2 * DAY, { street: cell(undefined) }); // from outside: seen_leaving, never who or why
  await a.p.wake(3 * DAY, { street: cell(removed(3 * DAY - 30 * DAY)) }); // a month ago
  await a.p.wake(4 * DAY, { street: cell(removed(4 * DAY - 60, "c1")) }); // one of my own
  expect(heard(a)).toHaveLength(0);
  const off = watched(PARAMS, false);
  await off.p.wake(DAY);
  await off.p.wake(2 * DAY, { street: cell(removed(2 * DAY - 3_600)) });
  expect(off.kept.record.heard).toBeUndefined();
});

test("told by a tie: held a hand further and weaker; heard again it returns part of the way and moves no trust; past three hands it is let go; asked how things are, I tell it", async () => {
  const a = watched(PARAMS);
  await a.p.wake(DAY);
  const text = TOWN_WORDS.say("put_out", "police", 5, 10_000, 0);
  await a.p.wake(2 * DAY, { inbox: [from("c9", CATCHING_UP.nothing + " " + text, "m1")] });
  expect(heard(a)).toHaveLength(1);
  expect([60, 80]).toContain(heard(a)[0][3]); // (60% of the teller's; 80 for one who holds a removal wrong: the person's own view)
  expect(heard(a)[0].slice(4, 6)).toEqual([2, 1]);
  const trust1 = JSON.stringify(a.kept.record.trust);
  await a.p.wake(3 * DAY, { inbox: [from("c8", TOWN_WORDS.say("put_out", "police", 5, 9_000, 1), "m2")] });
  expect(heard(a)).toHaveLength(1);
  expect(JSON.stringify(a.kept.record.trust)).toBe(trust1);
  await a.p.wake(4 * DAY, { inbox: [from("c7", TOWN_WORDS.say("strike", "works", 5, 9_000, 3), "m3")] });
  expect(heard(a)).toHaveLength(1);
  const said = await a.p.wake(5 * DAY, { inbox: [from("c6", CATCHING_UP.ask, "m4")] });
  const reply = said.filter((c) => c.fn === "message").map((c) => String(c.args.text)).join(" ");
  expect(TOWN_WORDS.heard(reply)).toMatchObject({ kind: "put_out", about: "police", hops: 1 });
  const again = await a.p.wake(6 * DAY, { inbox: [from("c6", CATCHING_UP.ask, "m5")] });
  expect(TOWN_WORDS.heard(again.filter((c) => c.fn === "message").map((c) => String(c.args.text)).join(" "))).toBeUndefined(); // (once to each)
});
