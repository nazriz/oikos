// What a seat reads of when a standing paper starts (wave 2a's review of 2026-10-09, fault 2). A finance seat wanted
// a wage to start on year 1, day 22. Its draft said `first="14 days"` on day 8, which was right, and the preview read
// "first: year 1, day 15": the length of time shown as a date counted from the world's start. It declined four right
// drafts and then confirmed `first="21 days"` on day 15 because the preview read "year 1, day 22"; the bank, counting
// from the day it had the instruction, paid from day 36. A seat's sign-off is the label a translator is trained on,
// so the preview must say what will happen. Held here: the preview says when the first time falls as whoever acts on
// the paper will count it (participants: `firstDue`), for a date, a length of time and neither; the seat's own copy
// of the paper says the same; and dates that office papers carry are read as dates.

import { expect, test } from "bun:test";
import { calls, firstDue } from "@oikos/participants";
import { readable } from "@oikos/participants/llm";
import TABLE from "../../contracts/test/when.json";
import { Knowledge, Preview } from "../src/index";
import { resolve } from "../src/resolver";

const DAY = 86_400;
const seat = () => { const k = new Knowledge(TABLE.currency); k.absorb(TABLE.observation as any); return k; };

/** The preview of a program, as the finance seat of the table reads it at the table's moment (year 1, day 31). */
const preview = (program: string) => {
  const k = seat();
  const r = resolve(calls.parseProgram(program), k, () => undefined, "finance");
  if (!r.ok) throw new Error(r.questions.join(" "));
  return { text: new Preview(k, k.actingFor("finance"), undefined, "finance").of(r.blocks), blocks: r.blocks as any[] };
};
/** When whoever acts on the paper will first act on it, if it is lodged `later` seconds after it was drafted. */
const due = (b: any, otherwise: number, later = 1) => firstDue({ at: TABLE.now + later, data: b.data }, otherwise);

test("the preview of a standing payment says when the first payment falls, as the bank will count it", () => {
  const pay = (rest: string) => preview(`money(to=acc-c0003, amount="2393.34", from=acc-city, every="14 days"${rest})`);
  // A date: that date, and nothing counted from anywhere.
  const dated = pay(', first="year 1, day 45"');
  expect(dated.text).toContain("The first payment falls due on year 1, day 45, and then every 14 days from that date.");
  expect(dated.text).toContain("to acc-c0003 every 14 days.\n   - The first payment falls due on year 1, day 45, and then every 14 days from that date.");
  expect(due(dated.blocks[0], 14 * DAY)).toBe(44 * DAY);
  expect(due(dated.blocks[0], 14 * DAY, 3 * DAY)).toBe(44 * DAY); // (whenever it is lodged)
  // A length of time: counted from when it is lodged, said so, with the day that comes to today. (The wave's case:
  // "21 days" asked on day 15 read "first: year 1, day 22", and the bank paid from day 36.)
  const counted = pay(', first="21 days"');
  expect(counted.text).toContain("The first payment falls due 21 days after this is lodged: on year 1, day 52 if it is lodged today (year 1, day 31), and then every 14 days.");
  expect(Math.floor(due(counted.blocks[0], 14 * DAY) / DAY) + 1).toBe(52);
  // No first at all: the bank's own rule is said, where the seat read nothing before and feared a payment at once.
  const bare = pay("");
  expect(bare.text).toContain("No first date is given: the first payment falls due 14 days after this is lodged, one whole period: on year 1, day 45 if it is lodged today (year 1, day 31), and then every 14 days.");
  expect(Math.floor(due(bare.blocks[0], 14 * DAY) / DAY) + 1).toBe(45);
  // Today.
  expect(pay(', first="today"').text).toContain("The first payment falls due as soon as this is lodged, and then every 14 days.");
  expect(pay(', first="year 1, day 31"').text).toContain("The first payment falls due on year 1, day 31, which is today, and then every 14 days from that date.");
  // Nowhere is a length of time read as a date counted from the world's start, and no figure is left bare.
  for (const p of [dated, counted, bare]) {
    expect(p.text).not.toContain("first: ");
    expect(p.text).not.toMatch(/[0-9]{6,}/);
  }
  // A payment made once says nothing of a first time.
  expect(preview('money(to=acc-c0003, amount="100", from=acc-city)').text).not.toContain("falls due");
});

test("the preview of a standing work order says when it starts and when it ends", () => {
  const dated = preview('work(task=collect, at=town-hall, every="7 days", first="year 1, day 40", until="year 1, day 90")');
  expect(dated.text).toContain("   - It is in force from year 1, day 40.\n   - It stands to the end of year 1, day 90.");
  expect(due(dated.blocks[0], 0)).toBe(39 * DAY);
  expect(dated.blocks[0].data.until).toBe(90 * DAY);
  const counted = preview('work(task=collect, at=town-hall, every="weekly", first="3 days", until="8 weeks")');
  expect(counted.text).toContain("It comes into force 3 days after it is put on file: on year 1, day 34 if that is today (year 1, day 31).\n   - It stands until year 1, day 87, 09:00.");
  expect(preview('work(task=collect, at=town-hall, every="weekly")').text).toContain("It is in force as soon as it is on file.");
});

test("a seat's own copy of a standing paper reads the first time as it is counted, never as a date from the world's start", () => {
  // In a paper's details, `first` beside what the paper is for is a length of time from its lodging.
  const money = { money: (a: string | number) => `XYZ ${Number(a) / 100}` };
  expect(readable({ outcome: { money: { to: "acc-1", amount: "100" } }, every: 14 * DAY, first: 21 * DAY }, money)).toMatchObject({ every: "14 days", first: "21 days after it is lodged" });
  expect(readable({ work: { task: "collect", at: "depot" }, every: 7 * DAY, first: 0, until: 90 * DAY })).toMatchObject({ first: "when it is lodged", until: "year 1, day 91" });
  expect(readable({ outcome: { money: { to: "acc-1", amount: "100" } }, every: 14 * DAY, first_at: 21 * DAY }, money)).toMatchObject({ first_at: "year 1, day 22" });
  // A recurring gathering's first is a moment, as it was.
  expect(readable({ at: "hall/room.1", every: 7 * DAY, first: 3 * DAY })).toMatchObject({ first: "year 1, day 4" });
  // Dates by the names office papers give them, and a fine, are read as dates and money.
  expect(readable({ first_pay: 77 * DAY, period: 73 * DAY, last_day: 100 * DAY })).toEqual({ first_pay: "year 1, day 78", period: "73 days", last_day: "year 1, day 101" });
  expect(readable({ lease: "rec.9", rent: "90000", from: 60 * DAY, was: 85000, last_from: 0 }, money)).toMatchObject({ from: "year 1, day 61", last_from: "year 1, day 1" });
});

