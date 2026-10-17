// The world's calendar: a reading of the clock, as config data (docs/design/names-and-dates.md section 5). The kernel's
// time stays seconds from the world's start; this maps a moment to a civil date by the real Gregorian calendar from the
// world's start date, and writes and reads a date in the words of the place (the profile's `calendar`: its pattern, its
// month and weekday names). The twin of kernel/crates/rules/src/calendar.rs, both held to contracts/test/dates.json.
// The code holds no month name and no place's way of writing a date: without a style a date is ISO ("2026-03-12").

const DAY = 86_400;

/** The world's `calendar` section as the config carries it. */
export interface WorldCalendar {
  /** The first day of the run, "YYYY-MM-DD". */
  start: string;
  /** The days of rest (Monday 0 .. Sunday 6). */
  weekend?: number[];
  /** Holidays as civil dates "YYYY-MM-DD", as the generator listed them for the run's years. */
  holidays?: string[];
  /** How a date is written: `{d}` `{dd}` `{month}` `{m}` `{y}` (and `{weekday}` in the long form). */
  format?: string;
  long_format?: string;
  /** Twelve month names, January first; seven weekday names, Monday first. */
  months?: string[];
  weekdays?: string[];
}

export interface Civil { year: number; month: number; day: number }

/** Days from 1970-01-01 to a civil date (H. Hinnant, "chrono-compatible low-level date algorithms"). */
export function daysFromCivil(d: Civil): number {
  const y = d.year - (d.month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const m = d.month;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** The civil date of a day counted from 1970-01-01. */
export function civilFromDays(z0: number): Civil {
  const z = z0 + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function daysInMonth(year: number, month: number): number {
  return civilFromDays(daysFromCivil(month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 }) - 1).day;
}

export function parseIso(s: string): Civil | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= daysInMonth(d.year, d.month) ? d : undefined;
}

/** The civil date of moment `t` (seconds from the world's start). */
export function dateOf(cal: WorldCalendar, t: number): Civil {
  return civilFromDays(daysFromCivil(parseIso(cal.start)!) + Math.floor(t / DAY));
}

/** The moment a civil date begins (negative before the start). */
export function momentOf(cal: WorldCalendar, d: Civil): number {
  return (daysFromCivil(d) - daysFromCivil(parseIso(cal.start)!)) * DAY;
}

/** The day of the week of moment `t`, Monday 0 to Sunday 6. */
export function weekdayOf(cal: WorldCalendar, t: number): number {
  return (((daysFromCivil(dateOf(cal, t)) + 3) % 7) + 7) % 7;
}

/** Whether moment `t` is a working day: not a day of rest, not a holiday. */
export function workingDay(cal: WorldCalendar, t: number): boolean {
  const d = dateOf(cal, t);
  const iso = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  return !(cal.weekend ?? []).includes(weekdayOf(cal, t)) && !(cal.holidays ?? []).includes(iso);
}

const isoOf = (d: Civil) => `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** A moment in the place's words ("12 March 2026"; `long`: "Thursday 12 March 2026"); ISO where the calendar has no style. */
export function calendarWords(cal: WorldCalendar, t: number, long = false): string {
  const d = dateOf(cal, t);
  const f = long ? cal.long_format ?? cal.format : cal.format;
  if (!f || (cal.months ?? []).length !== 12) return isoOf(d);
  return f
    .replaceAll("{weekday}", cal.weekdays?.[weekdayOf(cal, t)] ?? "")
    .replaceAll("{month}", cal.months![d.month - 1]!)
    .replaceAll("{dd}", String(d.day).padStart(2, "0"))
    .replaceAll("{d}", String(d.day))
    .replaceAll("{m}", String(d.month))
    .replaceAll("{y}", String(d.year));
}

/**
 * A date as a person writes it, read to the moment that day begins: in the place's order ("12 March 2026", "March 12,
 * 2026", "12.03.2026"), with or without the weekday, "12th", a month's short form, a missing year (the year of `now`),
 * or ISO. Undefined: not a date. No guessing between two readings: a numeric date is read in the place's order only,
 * ISO excepted.
 */
export function readCalendarDate(cal: WorldCalendar, text: string, now: number): number | undefined {
  const months = (cal.months ?? []).map((m) => m.toLowerCase());
  let rest = text.trim().toLowerCase();
  for (const w of cal.weekdays ?? []) {
    const full = w.toLowerCase();
    for (const cand of [full, [...full].slice(0, 3).join("")]) {
      if (rest.startsWith(cand) && !/^[\p{L}\p{N}]/u.test(rest.slice(cand.length))) rest = rest.slice(cand.length).replace(/^[ ,.]+/, "");
    }
  }
  type Tok = { num: number; len: number } | { month: number };
  const toks: Tok[] = [];
  for (let i = 0; i < rest.length;) {
    const c = rest[i]!;
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < rest.length && /[0-9]/.test(rest[j]!)) j++;
      toks.push({ num: Number(rest.slice(i, j)), len: j - i });
      i = j;
    } else if (/\p{L}/u.test(c)) {
      let j = i;
      while (j < rest.length && /\p{L}/u.test(rest[j]!)) j++;
      const word = rest.slice(i, j);
      i = j;
      if (["st", "nd", "rd", "th", "of", "the"].includes(word)) continue;
      let m = months.indexOf(word);
      if (m < 0) {
        const hits = word.length >= 3 ? months.flatMap((x, n) => (x.startsWith(word) ? [n] : [])) : [];
        if (hits.length !== 1) return undefined;
        m = hits[0]!;
      }
      toks.push({ month: m + 1 });
    } else if (" ,.-/".includes(c)) i++;
    else return undefined;
  }
  const order = (): string => {
    const f = cal.format ?? "{y}-{m}-{d}";
    const at: [number, string][] = [];
    for (const [tag, k] of [["{dd}", "d"], ["{d}", "d"], ["{month}", "m"], ["{m}", "m"], ["{y}", "y"]] as const) {
      const i = f.indexOf(tag);
      if (i >= 0) at.push([i, k]);
    }
    return at.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join("");
  };
  const yearNow = dateOf(cal, now).year;
  const num = (t: Tok | undefined): t is { num: number; len: number } => !!t && "num" in t;
  const mon = (t: Tok | undefined): t is { month: number } => !!t && "month" in t;
  let d: number, m: number, y: number;
  const [a, b, c] = toks;
  if (toks.length === 3 && num(a) && mon(b) && num(c) && c.len === 4 && a.len <= 2) [d, m, y] = [a.num, b.month, c.num];
  else if (toks.length === 3 && num(a) && mon(b) && num(c) && a.len === 4 && c.len <= 2) [d, m, y] = [c.num, b.month, a.num];
  else if (toks.length === 3 && mon(a) && num(b) && num(c) && b.len <= 2 && c.len === 4) [d, m, y] = [b.num, a.month, c.num];
  else if (toks.length === 2 && num(a) && mon(b) && a.len <= 2) [d, m, y] = [a.num, b.month, yearNow];
  else if (toks.length === 2 && mon(a) && num(b) && b.len <= 2) [d, m, y] = [b.num, a.month, yearNow];
  else if (toks.length === 3 && num(a) && num(b) && num(c)) {
    if (a.len === 4 && b.len <= 2 && c.len <= 2) [d, m, y] = [c.num, b.num, a.num];
    else if (c.len === 4 && a.len <= 2 && b.len <= 2) {
      const o = order();
      if (o === "mdy") [d, m, y] = [b.num, a.num, c.num];
      else if (o === "dmy") [d, m, y] = [a.num, b.num, c.num];
      else return undefined;
    } else return undefined;
  } else return undefined;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined;
  return momentOf(cal, { year: y, month: m, day: d });
}

// The calendar of the world now being stepped, said the way the money is (`inCurrency`, participants/src/money.ts): a
// code participant's rules write dates in many places (reports, letters, reasons); rather than hand the calendar to each,
// whoever steps a participant says whose world it is in first (`inCalendar`: the run, from the world's config), and the
// rules' words read it. A step is synchronous, so two worlds in one process cannot cross. A world with no calendar (the
// old towns) writes "year N, day D" as ever.
let current: WorldCalendar | undefined;

/** Say which world's calendar dates are worded in from here on (the config's `calendar`; undefined: none). */
export function inCalendar(cal: WorldCalendar | undefined): void {
  current = cal;
}

/** The calendar of the world now being stepped, if it has one. */
export function calendarNow(): WorldCalendar | undefined {
  return current;
}
