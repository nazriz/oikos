// What people and bodies are called, and the days they are called by (docs/design/names-and-dates.md). The generator's
// code is general: every name, pattern and date format is a profile's (`values.names`, `values.calendar`), with its
// source. This file checks a profile's sections and draws from them.
//
//   bun worlds/generator/names.ts <profile id>...     checks the profiles' sections and prints a summary

import { civilFromDays, daysFromCivil, daysInMonth, parseIso, type Civil } from "@oikos/participants";
import { loadProfile, type CalendarSection, type HolidayRule, type NamesSection, type Profile, type Weighted } from "./profile";

const TOKENS = new Set(["d", "dd", "month", "m", "y", "weekday"]);

function weightedProblems(at: string, l: Weighted[] | undefined, out: string[]): void {
  if (!Array.isArray(l) || l.length < 1) return void out.push(`${at}: no names`);
  const seen = new Set<string>();
  for (const w of l) {
    if (typeof w.name !== "string" || !w.name.trim()) out.push(`${at}: an empty name`);
    else if (seen.has(w.name)) out.push(`${at}: ${w.name} twice`);
    else seen.add(w.name);
    if (!Number.isInteger(w.weight) || w.weight <= 0) out.push(`${at}: ${w.name} has weight ${w.weight} (a positive whole number)`);
  }
}

/** The ways a date format is wrong (empty: well formed). */
export function formatProblems(f: string, withWeekday: boolean): string[] {
  const out: string[] = [];
  const used = [...f.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  for (const t of used) if (!TOKENS.has(t)) out.push(`format "${f}": unknown token {${t}}`);
  if (!used.includes("y")) out.push(`format "${f}": no {y}`);
  if (!used.some((t) => t === "d" || t === "dd")) out.push(`format "${f}": no day`);
  if (!used.some((t) => t === "month" || t === "m")) out.push(`format "${f}": no month`);
  if (withWeekday !== used.includes("weekday")) out.push(`format "${f}": ${withWeekday ? "no" : "a"} {weekday}`);
  return out;
}

export function calendarProblems(c: CalendarSection | undefined): string[] {
  if (!c) return ["no calendar"];
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.start_date)) out.push(`start_date "${c.start_date}" is not YYYY-MM-DD`);
  out.push(...formatProblems(c.format, false), ...formatProblems(c.long_format, true));
  if (!Array.isArray(c.months) || c.months.length !== 12 || new Set(c.months).size !== 12) out.push("months: twelve different names");
  if (!Array.isArray(c.weekdays) || c.weekdays.length !== 7 || new Set(c.weekdays).size !== 7) out.push("weekdays: seven different names, Monday first");
  if (!Array.isArray(c.weekend) || c.weekend.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) out.push("weekend: days 0 (Monday) to 6 (Sunday)");
  if (!Number.isInteger(c.week_starts) || c.week_starts < 0 || c.week_starts > 6) out.push("week_starts: 0 to 6");
  if (!c.fiscal_year_starts || c.fiscal_year_starts.month < 1 || c.fiscal_year_starts.month > 12 || c.fiscal_year_starts.day < 1 || c.fiscal_year_starts.day > 31) out.push("fiscal_year_starts: a month and a day");
  for (const h of c.holidays ?? []) {
    const kinds = ["fixed", "nth_weekday", "easter_offset", "on"].filter((k) => k in h);
    if (!h.name || kinds.length !== 1) out.push(`holiday "${h.name}": exactly one of fixed, nth_weekday, easter_offset, on`);
    if ("fixed" in h && !(h.fixed.month >= 1 && h.fixed.month <= 12 && h.fixed.day >= 1 && h.fixed.day <= 31)) out.push(`holiday "${h.name}": fixed date`);
    if ("nth_weekday" in h) { const n = h.nth_weekday; if (!(n.month >= 1 && n.month <= 12 && n.weekday >= 0 && n.weekday <= 6 && [1, 2, 3, 4, 5, -1].includes(n.n))) out.push(`holiday "${h.name}": nth_weekday`); }
    if (h.observed && Object.entries(h.observed).some(([k, v]) => !["saturday", "sunday"].includes(k) || !Number.isInteger(v))) out.push(`holiday "${h.name}": observed: saturday and sunday, whole days`);
    if ("easter_offset" in h && !Number.isInteger(h.easter_offset)) out.push(`holiday "${h.name}": easter_offset`);
    if ("on" in h && !(h.on.length > 0 && h.on.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))) out.push(`holiday "${h.name}": on: dates YYYY-MM-DD`);
  }
  return out;
}

export function namesProblems(n: NamesSection | undefined, groups: string[] = []): string[] {
  if (!n) return ["no names"];
  const out: string[] = [];
  const c = n.customs;
  if (!c || !["father", "both", "father_given", "own"].includes(c.family_name_from)) out.push("customs.family_name_from");
  if (!c || !["given_first", "family_first"].includes(c.order)) out.push("customs.order");
  if (c?.surname_order && !["father_first", "mother_first"].includes(c.surname_order)) out.push("customs.surname_order");
  if (!c || !Number.isInteger(c.wife_takes_husband_bps) || c.wife_takes_husband_bps < 0 || c.wife_takes_husband_bps > 10_000) out.push("customs.wife_takes_husband_bps: 0 to 10000");
  for (const sex of ["male", "female"] as const) {
    const cohorts = n.given?.[sex];
    if (!Array.isArray(cohorts) || cohorts.length < 1) { out.push(`given.${sex}: no cohorts`); continue; }
    let last = -Infinity;
    for (const k of cohorts) {
      if (!Number.isInteger(k.born_from) || k.born_from <= last) out.push(`given.${sex}: cohorts must ascend by born_from (${k.born_from})`);
      last = k.born_from;
      weightedProblems(`given.${sex}.${k.born_from}`, k.names, out);
    }
  }
  if (c?.family_name_from !== "father_given") weightedProblems("family.all", n.family?.all, out);
  for (const [g, l] of Object.entries(n.family?.by_group ?? {})) {
    if (groups.length && !groups.includes(g)) out.push(`family.by_group: ${g} is no origin group of the profile (${groups.join(", ")})`);
    weightedProblems(`family.by_group.${g}`, l, out);
  }
  const o = n.organisations;
  if (!o) out.push("no organisations");
  else {
    for (const k of ["landlord", "shop", "factory"] as const) {
      if (!Array.isArray(o[k]) || o[k].length < 1) out.push(`organisations.${k}: no patterns`);
      for (const p of o[k] ?? []) {
        if (!Number.isInteger(p.weight) || p.weight <= 0) out.push(`organisations.${k}: weight of "${p.template}"`);
        for (const slot of [...p.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)) {
          if (!["family", "town", "street"].includes(slot) && !o.lists?.[slot]?.length) out.push(`organisations.${k}: "${p.template}" uses {${slot}}, a list the profile lacks`);
        }
      }
    }
    if (!Number.isInteger(o.landlord_is_person_bps) || o.landlord_is_person_bps < 0 || o.landlord_is_person_bps > 10_000) out.push("organisations.landlord_is_person_bps");
  }
  if (!n.town || typeof n.town !== "string") out.push("town");
  if (!n.institutions || !n.institutions.city) out.push("institutions: at least `city`");
  for (const [series, pat] of Object.entries(n.references ?? {})) if (typeof pat !== "string" || !pat.includes("{n") || [...pat.matchAll(/\{(\w+)\}/g)].some((m) => !["y", "n", "n4", "n6"].includes(m[1]!))) out.push(`references.${series}: a pattern with {n}, {n4} or {n6} (and {y})`);
  if (!n.places || !Array.isArray(n.places.streets) || !n.places.building || !n.places.unit) out.push("places: streets, building, unit");
  return out;
}

/** The problems with a profile's names and calendar sections (empty: well formed; a section left out is no problem). */
export function profileNamesProblems(P: Profile): string[] {
  const out: string[] = [];
  const groups = (P.values.culture as any)?.origin?.groups?.map((g: { id: string }) => g.id) ?? [];
  if (P.values.names) out.push(...namesProblems(P.values.names, groups).map((x) => `names: ${x}`));
  if (P.values.calendar) out.push(...calendarProblems(P.values.calendar).map((x) => `calendar: ${x}`));
  const has = (path: string) => Object.keys(P.sources).some((k) => path === k || path.startsWith(`${k}.`));
  if (P.values.names) for (const k of ["names.customs", "names.given", "names.family", "names.organisations", "names.town", "names.institutions", "names.places"]) if (!has(k)) out.push(`sources: none for ${k}`);
  if (P.values.calendar) for (const k of ["calendar.start_date", "calendar.format", "calendar.months", "calendar.weekend", "calendar.fiscal_year_starts", "calendar.holidays"]) if (!has(k)) out.push(`sources: none for ${k}`);
  return out;
}

// ---- drawing names ----------------------------------------------------------------------------------------------------
// Every draw is on a stream keyed on the stable identity of what is named (a person's id, an organisation's id), never on
// the order things were made in, so that a town and its twin call everyone the same and adding a person or a shop moves
// no one else's name (docs/design/names-and-dates.md section 2). A name is drawn independently of everything a module
// reads except sex, cohort of birth and (where the profile has them) origin group: no module reads a name.

/** What a stream gives: `below(n)` is a whole number from 0 to n-1 (participants/src/rng.ts `Rng`). */
export interface Draws { below(n: number): number }
/** A stream of the generator's, by key (`R.stream(["generator", "names", ...key])`). */
export type Streams = (key: string[]) => Draws;

/** One of a weighted list, by the stream. */
export function pickWeighted(l: Weighted[], d: Draws): string {
  const total = l.reduce((a, x) => a + x.weight, 0);
  let r = d.below(total);
  for (const x of l) if ((r -= x.weight) < 0) return x.name;
  return l.at(-1)!.name;
}

/** The cohort list for someone born in a year: the latest cohort that begins no later (the first, for those before it). */
export function cohortFor<T extends { born_from: number }>(cohorts: T[], year: number): T {
  let best = cohorts[0]!;
  for (const c of cohorts) if (c.born_from <= year) best = c;
  return best;
}

/** A person of the town as the namer needs them. */
export interface Named { id: string; sex: "male" | "female"; born_at: number; parents?: string[] }

/** Whole calendar years, counting a year as the generator does (365 days). */
const YEAR_SECONDS = 365 * 86_400;

/**
 * The full name of everyone in a town. `couples` are the households' pairs; `groupOf` an origin group by person (where
 * the profile has them); `startYear` the year the run starts in (to give a birth year to `born_at`).
 * A household's members share a family name by the profile's customs (docs/design/names-and-dates.md section 2):
 * children take their father's, a wife takes her husband's with the profile's share, two family names where the place
 * writes two, the father's given name where it is a patronymic. Two people may share a full name; nothing dedupes.
 */
export function namePeople(N: NamesSection, people: Named[], couples: [string, string][], streams: Streams, startYear: number, groupOf: (id: string) => string | undefined = () => undefined): Map<string, string> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const c = N.customs;
  const birthYear = (p: Named) => startYear + Math.floor(p.born_at / YEAR_SECONDS);
  const given = new Map<string, string>();
  const givenOf = (p: Named): string => {
    let g = given.get(p.id);
    if (g === undefined) given.set(p.id, (g = pickWeighted(cohortFor(N.given[p.sex], birthYear(p)).names, streams(["given", p.id]))));
    return g;
  };
  const spouseOf = new Map<string, string>();
  for (const [a, b] of couples) { spouseOf.set(a, b); spouseOf.set(b, a); }
  const familyList = (id: string) => (groupOf(id) && N.family.by_group?.[groupOf(id)!]) || N.family.all;
  // A person's own family name(s), those they carry into marriage: [paternal, maternal] or [paternal].
  const own = new Map<string, string[]>();
  const familyOwn = (id: string, depth = 0): string[] => {
    let f = own.get(id);
    if (f) return f;
    const p = byId.get(id)!;
    const parents = (p.parents ?? []).filter((x) => byId.has(x));
    const father = parents.map((x) => byId.get(x)!).find((x) => x.sex === "male") ?? (parents[0] ? byId.get(parents[0]!) : undefined);
    const mother = parents.map((x) => byId.get(x)!).find((x) => x.sex === "female" && x.id !== father?.id);
    if (c.family_name_from === "both") {
      const paternal = father && depth < 8 ? familyOwn(father.id, depth + 1)[0]! : pickWeighted(familyList(id), streams(["family", id, "paternal"]));
      const maternal = mother && depth < 8 ? familyOwn(mother.id, depth + 1)[0]! : pickWeighted(familyList(id), streams(["family", id, "maternal"]));
      f = [paternal, maternal];
    } else if (c.family_name_from === "father_given") {
      f = [];
    } else {
      f = [father && depth < 8 ? familyOwn(father.id, depth + 1)[0]! : pickWeighted(familyList(id), streams(["family", id]))];
    }
    own.set(id, f);
    return f;
  };
  // What a person is called by: a wife who takes her husband's name has his.
  const carried = (p: Named): string[] => {
    const f = familyOwn(p.id);
    const sp = spouseOf.get(p.id) && byId.get(spouseOf.get(p.id)!);
    if (c.family_name_from === "father" && sp && p.sex === "female" && sp.sex === "male" && streams(["married", p.id]).below(10_000) < c.wife_takes_husband_bps && !(p.parents ?? []).some((x) => x === sp.id)) return familyOwn(sp.id);
    return f;
  };
  const out = new Map<string, string>();
  for (const p of people) {
    let fam: string[];
    if (c.family_name_from === "father_given") {
      // A patronymic: the father's given name stands as the second name (a father outside the town is drawn, a generation older).
      const parents = (p.parents ?? []).filter((x) => byId.has(x));
      const father = parents.map((x) => byId.get(x)!).find((x) => x.sex === "male");
      fam = [father ? givenOf(father) : pickWeighted(cohortFor(N.given.male, birthYear(p) - 28).names, streams(["father", p.id]))];
    } else {
      fam = carried(p);
      if (c.family_name_from === "both" && c.surname_order === "mother_first") fam = [...fam].reverse();
    }
    const parts = c.order === "family_first" ? [...fam, givenOf(p)] : [givenOf(p), ...fam];
    out.set(p.id, parts.join(" "));
  }
  return out;
}

const fillTemplate = (t: string, N: NamesSection, town: string, streams: Streams, key: string[]): string => t.replace(/\{(\w+)\}/g, (_, slot: string) => {
  if (slot === "town") return town;
  if (slot === "family") return pickWeighted(N.family.all?.length ? N.family.all : [{ name: town, weight: 1 }], streams([...key, "family"]));
  if (slot === "street") return N.places.streets.length ? N.places.streets[streams([...key, "street"]).below(N.places.streets.length)]! : town;
  const l = N.organisations.lists?.[slot] ?? [];
  return l.length ? l[streams([...key, slot]).below(l.length)]! : "";
});

/** Names of a town's landlords, shops or factories: a landlord is a person (by the profile's share) or a company; the
 * rest by weighted patterns. No two of a kind share a name (a fresh draw, up to 40 times, on the same stream). */
export function nameOrganisations(N: NamesSection, kind: "landlord" | "shop" | "factory", ids: string[], town: string, streams: Streams, startYear: number): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const id of ids) {
    const pick = streams([kind, id, "pattern"]);
    let name = "";
    for (let attempt = 0; attempt < 40 && (!name || used.has(name)); attempt++) {
      if (kind === "landlord" && pick.below(10_000) < N.organisations.landlord_is_person_bps) {
        const sex = pick.below(2) ? "male" : "female";
        const born = 1950 + pick.below(30);
        const g = pickWeighted(cohortFor(N.given[sex], born).names, pick);
        const fams = N.family.all?.length ? pickWeighted(N.family.all, pick) : "";
        name = N.customs.order === "family_first" ? `${fams} ${g}`.trim() : `${g} ${fams}`.trim();
        void startYear;
      } else {
        const patterns = N.organisations[kind];
        const total = patterns.reduce((a, x) => a + x.weight, 0);
        let r = pick.below(total);
        const t = (patterns.find((x) => (r -= x.weight) < 0) ?? patterns.at(-1)!).template;
        name = fillTemplate(t, N, town, streams, [kind, id, String(attempt)]);
      }
    }
    used.add(name);
    out.set(id, name);
  }
  return out;
}

/** The name of one of the town's bodies (`{town}` is the town's name), or undefined where the profile gives none. */
export function institutionName(N: NamesSection, key: string, town: string): string | undefined {
  const t = N.institutions[key];
  return t === undefined ? undefined : t.replaceAll("{town}", town);
}

/**
 * Addresses: a building's address from the lot it stands on (docs/design/names-and-dates.md section 2): the street it
 * faces, a number by position along it, and a flat by the building's own order. `x` and `y` are the lot's cell.
 */
export function buildingAddress(N: NamesSection, x: number, y: number, width: number): string {
  const streets = N.places.streets;
  if (!streets.length) return N.places.building.replace("{street}", "").replace("{number}", String(y * width + x + 1)).replace(/\s+/g, " ").trim();
  const wrap = Math.floor(y / streets.length);
  return N.places.building.replace("{street}", streets[y % streets.length]!).replace("{number}", String(2 * (x + width * wrap) + 1));
}
export function unitAddress(N: NamesSection, building: string, unit: number): string {
  return N.places.unit.replace("{building}", building).replace("{unit}", String(unit));
}

// ---- the calendar, as the config carries it ---------------------------------------------------------------------------

/** Easter Sunday of a year (the Gregorian computus: Meeus/Jones/Butcher). */
export function easter(year: number): Civil {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

const iso = (d: Civil) => `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** The dates of a profile's public holidays in the years a run covers (sorted, no repeats), as "YYYY-MM-DD". */
export function expandHolidays(rules: HolidayRule[], fromYear: number, toYear: number, weekend: number[]): string[] {
  const out = new Set<string>();
  const weekdayOf = (d: Civil) => (((daysFromCivil(d) + 3) % 7) + 7) % 7;
  const plus = (d: Civil, n: number) => civilFromDays(daysFromCivil(d) + n);
  for (const r of rules) {
    for (let y = fromYear; y <= toYear; y++) {
      let dates: Civil[] = [];
      if ("fixed" in r) dates = [{ year: y, month: r.fixed.month, day: r.fixed.day }];
      else if ("nth_weekday" in r) {
        const { month, weekday, n } = r.nth_weekday;
        if (n > 0) {
          const first = { year: y, month, day: 1 };
          const day = 1 + ((weekday - weekdayOf(first) + 7) % 7) + 7 * (n - 1);
          if (day <= daysInMonth(y, month)) dates = [{ year: y, month, day }];
        } else {
          const last = { year: y, month, day: daysInMonth(y, month) };
          dates = [plus(last, -((weekdayOf(last) - weekday + 7) % 7))];
        }
      } else if ("easter_offset" in r) dates = [plus(easter(y), r.easter_offset)];
      else dates = r.on.map((s) => parseIso(s)!).filter((d) => d.year === y);
      for (let d of dates) {
        if ("fixed" in r || "nth_weekday" in r || "easter_offset" in r) {
          const wd = weekdayOf(d);
          if (r.observed && wd === 5 && r.observed.saturday) d = plus(d, r.observed.saturday);
          else if (r.observed && wd === 6 && r.observed.sunday) d = plus(d, r.observed.sunday);
          else if (r.shift_if_rest) while (weekend.includes(weekdayOf(d)) || out.has(iso(d))) d = plus(d, 1);
        }
        out.add(iso(d));
      }
    }
  }
  return [...out].sort();
}

/** The config's `calendar` section for a profile and a start date (the profile's reference date unless a spec gives one). */
export function calendarConfig(C: CalendarSection, startDate: string | undefined, years: number): { [k: string]: unknown } {
  const start = startDate ?? C.start_date;
  const d = parseIso(start);
  if (!d) throw new Error(`start date ${start} is not a date (YYYY-MM-DD)`);
  return {
    start,
    weekend: C.weekend,
    holidays: expandHolidays(C.holidays, d.year, d.year + Math.ceil(years) + 1, C.weekend).filter((h) => h >= start),
    format: C.format,
    long_format: C.long_format,
    months: C.months,
    weekdays: C.weekdays,
    week_starts: C.week_starts,
    fiscal_year_starts: C.fiscal_year_starts,
  };
}

/** A working calendar for a run (law 10: the days a desk of people works), from the profile's days of rest and public
 * holidays: the days of the world's week it is closed (day d of the run is the week's day d mod 7) and the holidays as days
 * of the run. With the run's dates (`dated`), the week is the real one from the start date; without, a run has no dates,
 * and its week is the one its people keep (their working days first, its days of rest the week's last), the holidays
 * still those of the profile's year from its start date. */
export function workingCalendar(C: CalendarSection, startDate: string | undefined, years: number, dated: boolean): { weekdays: number[]; days: number[] } {
  const start = startDate ?? C.start_date;
  const d = parseIso(start);
  if (!d) throw new Error(`start date ${start} is not a date (YYYY-MM-DD)`);
  const day0 = daysFromCivil(d);
  const first = (((day0 + 3) % 7) + 7) % 7; // (1970-01-01 was a Thursday, Monday 0)
  const weekdays = dated
    ? [0, 1, 2, 3, 4, 5, 6].filter((p) => C.weekend.includes((first + p) % 7))
    : C.weekend.map((_, i) => 6 - i).sort((a, b) => a - b);
  const days = expandHolidays(C.holidays, d.year, d.year + Math.ceil(years) + 1, C.weekend)
    .map((h) => daysFromCivil(parseIso(h)!) - day0).filter((n) => n >= 0 && !weekdays.includes(n % 7));
  return { weekdays, days };
}

if (import.meta.main) {
  let bad = 0;
  for (const id of process.argv.slice(2)) {
    const P = loadProfile(id);
    const problems = profileNamesProblems(P);
    const n = P.values.names;
    console.log(`${id}: ${problems.length ? `${problems.length} problems` : "ok"}${n ? `; ${n.given.male.length}+${n.given.female.length} cohorts, ${n.family.all?.length ?? 0} family names, ${Object.keys(n.family.by_group ?? {}).length} groups` : ""}${P.values.calendar ? `; ${P.values.calendar.holidays.length} holidays` : ""}`);
    for (const p of problems) console.log(`  ${p}`);
    bad += problems.length;
  }
  process.exit(bad ? 1 : 0);
}
