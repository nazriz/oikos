// Town memory (docs/behaviour/culture.md; design 14e): a few typed slots, a strength that fades by a formula, retold along ties, held by whoever saw,
// read or was told it and by no other route; a removal seen only by those inside the building; trust moved once. Arithmetic and a citizen's eyes and ears:
// no model, no clock.

import { expect, test } from "bun:test";
import { CATCHING_UP, citizen } from "../src/behaviour/citizen";
import { cultureDial } from "../src/behaviour/culture";
import { EVENT_KINDS, rowStrengthPct, TOWN_WORDS, TownMemory } from "../src/behaviour/townmemory";
import { RECORD } from "../src/module";
import { DAY, person, statement } from "./stepping";

const dial = () => cultureDial({ dials: { culture: {} } })!;
const mem = () => new TownMemory(dial().params);

test("never more than six; the weakest gives way to a stronger arrival and a weaker one is dropped", () => {
  const m = mem();
  for (let i = 0; i < 6; i++) expect(m.read("law", `maker-${i}`, i * DAY, 10 * DAY, 3_000 + i * 100)).toBe("fresh");
  expect(m.size()).toBe(6);
  expect(m.read("law", "weaker", 0, 10 * DAY, 2_000)).toBe("dropped");
  expect(m.saw("put_out", "police", 9 * DAY, 10 * DAY)).toBe("fresh");
  expect(m.size()).toBe(6);
  expect(m.all().some((s) => s.about === "maker-0")).toBe(false);
  for (let i = 0; i < 200; i++) m.saw("strike", `e-${i}`, i * DAY, 10 * DAY + i);
  expect(m.size()).toBeLessThanOrEqual(6);
});

test("nothing is passed on past three hands; told, it is a part of the teller's strength, more for what is held against", () => {
  const m = mem();
  expect(m.heardFrom("put_out", "police", 5, 6 * DAY, 10_000, 3, false)).toBe("dropped"); // would be a fourth hand
  expect(m.heardFrom("put_out", "police", 5, 6 * DAY, 10_000, 2, false)).toBe("fresh");
  expect(m.all()[0]!.hops).toBe(3);
  expect(m.all()[0]!.s0).toBe(6_000);
  const n = mem();
  n.heardFrom("put_out", "police", 5, 6 * DAY, 10_000, 0, true);
  expect(n.all()[0]!.s0).toBe(8_000);
});

test("strength a year on is the formula's: halved in 365 days seen, in 180 read or told; hearing it again returns 30% of the way to what it first was", () => {
  const m = mem();
  m.saw("put_out", "police", 0, 0);
  m.read("law", "town", 0, 0, 4_000);
  const [seen, read] = [m.all()[0]!, m.all()[1]!];
  expect(m.strength(seen, 365 * DAY)).toBe(5_000);
  expect(m.strength(read, 180 * DAY)).toBe(2_000);
  expect(m.strength(read, 360 * DAY)).toBe(1_000);
  // Heard again after a year: from 5,000 toward 10,000 by 30%.
  expect(m.heardFrom("put_out", "police", 0, 365 * DAY, 8_000, 0, false)).toBe("again");
  expect(m.strength(seen, 365 * DAY)).toBe(6_500);
  // The record's row says the same without storing the fading: the strength in the row is the day it last arrived.
  const row = m.section()[0]!;
  expect(row[0]).toBe(EVENT_KINDS.indexOf("put_out"));
  expect(rowStrengthPct(row, 365 + 365, dial().params)).toBeCloseTo(32.5, 5);
});

test("the section is positional, small, the same array until something arrives, and is not changed by the days going", () => {
  const m = mem();
  expect(m.section()).toEqual([]);
  m.saw("put_out", "police", 100 * DAY, 101 * DAY);
  m.read("vote", "council", 90 * DAY, 101 * DAY, 4_000);
  const a = m.section();
  expect(JSON.stringify(a).length).toBeLessThan(120);
  expect(m.section()).toBe(a);
  m.tell("x", 400 * DAY);
  expect(m.section()).toBe(a); // (telling changes no row)
  m.saw("strike", "works", 500 * DAY, 501 * DAY);
  expect(m.section()).not.toBe(a);
});

test("telling: the strongest above the line, one phrase, once to each who asks; nothing is drawn; the words round-trip", () => {
  const m = mem();
  m.read("law", "town", 10 * DAY, 11 * DAY, 3_000);
  m.saw("put_out", "police", 20 * DAY, 21 * DAY);
  const first = m.tell("a", 22 * DAY)!;
  expect(TOWN_WORDS.heard(first)).toMatchObject({ kind: "put_out", about: "police", day: 20, hops: 0 });
  expect(TOWN_WORDS.heard(m.tell("a", 22 * DAY)!)).toMatchObject({ kind: "law" });
  expect(m.tell("a", 22 * DAY)).toBeUndefined();
  expect(m.tell("b", 22 * DAY)).toBeDefined();
  expect(m.tell("c", 3_000 * DAY)).toBeUndefined(); // faded below the line
  expect(TOWN_WORDS.heard(`Much the same. ${first} Nothing else.`)).toMatchObject({ kind: "put_out" });
  expect(TOWN_WORDS.heard("Talk of the town: a ruling by the moon, x, day 3; I hold it at 5 in 10, through 0 hands.")).toBeUndefined();
});

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
