// Ordinary dates (docs/design/names-and-dates.md section 5): a calendar writes and reads the place's dates, held to the
// same cases as kernel/crates/rules (contracts/test/dates.json); the world being stepped says which calendar the rules'
// words read, as it says which money (`inCalendar`); the old "year N, day D" still reads.

import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calendarNow, calendarWords, inCalendar, readCalendarDate, workingDay, type WorldCalendar } from "../src/calendar";
import { dateWords, parseDate } from "../src/forms";
import { parseWhen } from "../src/calls";
import { reference } from "../src/identity";

const table = JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/test/dates.json"), "utf8")) as {
  now: number;
  calendars: { [name: string]: WorldCalendar & { start: string } };
  words: { calendar: string; t: number; long: boolean; text: string }[];
  reads: { calendar: string; text: string; at: number }[];
  refused: { calendar: string; text: string }[];
};
const DAY = 86_400;

afterEach(() => inCalendar(undefined));

test("a calendar writes the place's dates as the shared cases have them", () => {
  for (const w of table.words) expect(calendarWords(table.calendars[w.calendar]!, w.t, w.long), JSON.stringify(w)).toBe(w.text);
});

test("a calendar reads a date as a person writes it, and refuses what is not one", () => {
  for (const r of table.reads) expect(readCalendarDate(table.calendars[r.calendar]!, r.text, table.now), JSON.stringify(r)).toBe(r.at);
  for (const r of table.refused) expect(readCalendarDate(table.calendars[r.calendar]!, r.text, table.now), JSON.stringify(r)).toBeUndefined();
});

test("the rules' words read the calendar of the world now being stepped; with none, 'year N, day D' as ever", () => {
  expect(calendarNow()).toBeUndefined();
  expect(dateWords(0)).toBe("year 1, day 1");
  expect(parseDate("year 1, day 22")).toBe(21 * DAY);
  inCalendar(table.calendars.dmy);
  expect(dateWords(DAY)).toBe("13 March 2026");
  expect(dateWords(DAY, true)).toBe("Friday 13 March 2026");
  expect(parseDate("15 April 2026", 21 * DAY)).toBe(34 * DAY);
  expect(parseDate("year 1, day 22", 21 * DAY)).toBe(21 * DAY);
  expect(() => parseDate("31 February 2026", 21 * DAY)).toThrow('A date is written like "2 April 2026"');
  expect(parseWhen("from 15 April 2026", 21 * DAY)).toEqual({ at: 34 * DAY });
  expect(parseWhen("on the 3rd of May", 21 * DAY)).toEqual({ at: 52 * DAY });
  expect(parseWhen("in 14 days", 21 * DAY)).toEqual({ in: 14 * DAY });
  expect(parseWhen("a fortnight", 21 * DAY)).toEqual({ in: 14 * DAY });
  inCalendar(undefined);
  expect(() => parseWhen("from 15 April 2026", 21 * DAY)).toThrow();
});

test("working days: a day of rest or a holiday is not one", () => {
  const cal: WorldCalendar = { ...table.calendars.dmy!, holidays: ["2026-04-03"] };
  expect(workingDay(cal, 0)).toBe(true);
  expect(workingDay(cal, 2 * DAY)).toBe(false);      // Saturday 14 March
  expect(workingDay(cal, 22 * DAY)).toBe(false);     // 3 April, a holiday
});

test("an office's reference for a record is its pattern with its own year and number, as the shared cases have it", () => {
  const cases = JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/test/references.json"), "utf8")).cases as { pattern: string; year: number; n: number; text: string }[];
  for (const c of cases) expect(reference(c.pattern, c.year, c.n), JSON.stringify(c)).toBe(c.text);
});
