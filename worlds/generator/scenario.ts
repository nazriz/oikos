// Scenarios (docs/scenarios.md): named starting conditions for a generated world. A scenario is data
// (worlds/scenarios/<id>.yaml): shifts to what a world starts from and to the parameters its mechanisms run on, each
// with the real-world basis for its size. It is applied here, to the world's description and to a copy of its profile,
// before anything is generated; the generator then makes the world as it makes any other. Nothing is made to happen
// during a run, and nothing a scenario says reaches a participant: a world under one differs only in what is true of it.
//
// A scenario is for any place: it may not give a place's figures. Money and quantities are changed only by multiples of
// the profile's own; only shares, counts of days and the like may be set outright; the weather of a run is one of the
// climate's own years, chosen by where it stands among them. The rules below enforce it.

import { checkCapability, type CapabilitySpec } from "./capability";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Profile } from "./profile";
import type { WeatherChoice } from "./weather";

export const SCENARIO_DIR = join(import.meta.dir, "../scenarios");

type Op = "set" | "times_bps" | "shortfall_times_bps" | "add";

export interface ScenarioChange {
  /** What is changed: the town's description (its spec) or a figure of its profile (a path into the profile's values). */
  in: "town" | "profile";
  path: string;
  /** Of a list of rows at `path`: the rows whose `where.field` is within the bounds, and of each the field `of`. */
  where?: { field: string; at_least?: number; at_most?: number };
  of?: string;
  /** The value outright: only for a share, a count of days, months or years. */
  set?: number;
  /** A multiple of what is there (10,000 = unchanged). */
  times_bps?: number;
  /** For a share of 10,000: a multiple of what it falls short by (an employed share of 9,500 at 20,000 is 9,000:
   * twice as many out of work). */
  shortfall_times_bps?: number;
  /** A row added to a list (the world market's conditions from the first day). */
  add?: Record<string, unknown>;
  /** The real-world basis for the size of the change, or that it is a placeholder. */
  basis: string;
}

export interface Scenario {
  id: string;
  /** What it is, for whoever chooses it (never shown to a participant). */
  about: string;
  /** The offices it mainly bears on (for choosing; nothing reads it). */
  bears_on: string[];
  changes?: ScenarioChange[];
  /** The season the run starts in, by the profile's climate: the half-year the river is sent most or least, or the
   * first of its hot months. */
  season?: { starts_in: "wet_half" | "dry_half" | "hot_months"; basis: string };
  /** Which of the climate's own years the run is given (weather.ts, `WeatherChoice`). */
  weather?: WeatherChoice & { basis: string };
  /** `inert`: measured against the plain town, its conditions hold but nothing of them reaches an office, and they
   * can't until the platform changes (`inert_because` says what is missing). It can still be named; it is left out
   * of the scenarios offered by default (`offeredScenarioIds`). Absent: it bites. */
  status?: "inert";
  inert_because?: string;
  /** The outside world's capability over time (worlds/generator/capability.ts): releases of what it sells, from the first
   * day at a rate, each quicker and slipping less. */
  capability?: CapabilitySpec & { basis: string };
}

/** What a scenario may change of a town's description, and how. (Not its name, seed, profile or size; not its own
 * figures in money; not a day-by-day script of anything.) */
const TOWN: { [path: string]: Op[] } = {
  housed_bps: ["set", "times_bps", "shortfall_times_bps"],
  employed_bps: ["set", "times_bps", "shortfall_times_bps"],
  landlord_compliance_bps: ["set", "times_bps", "shortfall_times_bps"],
  first_election_days: ["set"],
  houses: ["times_bps"],
  apartment_blocks: ["times_bps"],
  shops: ["times_bps"],
  factories: ["times_bps"],
  shocks: ["add"],
};
/** A profile figure that may be set outright: a share or a rate in basis points, or a count of days, months or years. */
const SETTABLE = /_bps(_|$)|_(days|months|years)$/;
const OPS: Op[] = ["set", "times_bps", "shortfall_times_bps", "add"];

const fail: (id: string, what: string) => never = (id, what) => {
  throw new Error(`scenario ${id}: ${what}`);
};

/** A scenario as written, checked: every change says what it does and on what basis, and does only what a scenario may. */
export function checkScenario(s: Scenario): Scenario {
  const id = String(s?.id ?? "?");
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(id, "its id is lower-case words joined by hyphens");
  for (const k of Object.keys(s)) if (!["id", "about", "bears_on", "changes", "season", "weather", "status", "inert_because", "capability"].includes(k)) fail(id, `"${k}" is nothing a scenario has`);
  if (!s.about?.trim()) fail(id, "says nothing about itself (about)");
  if (!Array.isArray(s.bears_on)) fail(id, "doesn't say which offices it bears on (bears_on)");
  if (s.status !== undefined && s.status !== "inert") fail(id, "its status, if it has one, is inert");
  if ((s.status === "inert") !== !!s.inert_because?.trim()) fail(id, "an inert scenario says what is missing (inert_because), and only an inert one does");
  const based = (x: { basis?: string } | undefined, what: string) => { if (!x?.basis?.trim()) fail(id, `${what} gives no basis`); };
  for (const c of s.changes ?? []) {
    const at = `${c.in}.${c.path}`;
    based(c, at);
    const ops = OPS.filter((o) => c[o] !== undefined);
    if (ops.length !== 1) fail(id, `${at} must do exactly one of ${OPS.join(", ")}`);
    const op = ops[0]!;
    if (op !== "add" && !(typeof c[op] === "number" && Number.isFinite(c[op]) && c[op]! >= 0)) fail(id, `${at}: ${op} takes a number, not below nothing`);
    if (c.in === "town") {
      if (!TOWN[c.path]) fail(id, `a scenario may not change a town's ${c.path} (it may change: ${Object.keys(TOWN).join(", ")})`);
      if (!TOWN[c.path]!.includes(op)) fail(id, `a town's ${c.path} may only be changed by ${TOWN[c.path]!.join(", ")}`);
      if (c.where || c.of) fail(id, `${at}: rows are chosen in a profile's lists only`);
      if (op === "add") {
        // The world market's conditions: as the run finds them on its first day, never from a later one (that would
        // be an event made to happen).
        const a = c.add as { from_day?: unknown; kind?: unknown; what?: unknown; factor_bps?: unknown };
        if (a.from_day !== 0) fail(id, `${at}: a scenario's conditions hold from the first day (from_day: 0); a later day is an event made to happen`);
        if (typeof a.kind !== "string" || (a.what !== "price" && a.what !== "demand") || typeof a.factor_bps !== "number") fail(id, `${at}: expected { from_day: 0, kind, what: price | demand, factor_bps }`);
      }
    } else if (c.in === "profile") {
      if (/^currency(\.|$)/.test(c.path)) fail(id, "a scenario may not change a place's money");
      if (op === "add") fail(id, `${at}: nothing is added to a profile`);
      if (!!c.where !== !!c.of) fail(id, `${at}: rows are chosen with both where and of`);
      const key = c.of ?? c.path.split(".").at(-1)!;
      if (op === "set" && !SETTABLE.test(key)) fail(id, `${at}: only a share (..._bps) or a count of days, months or years may be set outright; change ${key} by a multiple of the profile's own (times_bps)`);
    } else fail(id, `a change is in the town or in the profile, not in "${(c as { in: string }).in}"`);
  }
  if (s.capability) {
    based(s.capability, "capability");
    checkCapability(s.capability, `scenario ${id}`);
  }
  if (s.season) {
    based(s.season, "season");
    if (!["wet_half", "dry_half", "hot_months"].includes(s.season.starts_in)) fail(id, "season.starts_in is wet_half, dry_half or hot_months");
  }
  if (s.weather) {
    based(s.weather, "weather");
    const w = s.weather;
    if (!["wettest_spell", "inflow", "heatwave_days"].includes(w.rank_by)) fail(id, "weather.rank_by is wettest_spell, inflow or heatwave_days");
    if (!(w.percentile >= 0 && w.percentile <= 100)) fail(id, "weather.percentile is from 0 to 100");
    if (!(Number.isInteger(w.draws) && w.draws >= 1 && w.draws <= 1000)) fail(id, "weather.draws is a whole number from 1 to 1,000");
    if (!(Number.isInteger(w.over_days) && w.over_days >= 1)) fail(id, "weather.over_days is a whole number of days");
  }
  return s;
}

/** The scenario of that name (worlds/scenarios/<id>.yaml). */
export function loadScenario(id: string): Scenario {
  const path = join(SCENARIO_DIR, `${id}.yaml`);
  if (!/^[a-z][a-z0-9-]*$/.test(id) || !existsSync(path)) throw new Error(`no scenario "${id}" (there are: ${scenarioIds().join(", ")})`);
  const s = checkScenario(Bun.YAML.parse(readFileSync(path, "utf8")) as Scenario);
  if (s.id !== id) fail(id, `its file says it is "${s.id}"`);
  return s;
}

/** Every scenario there is, by name. */
export function scenarioIds(): string[] {
  return readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5)).sort();
}

/** The scenarios offered by default: every one but those marked inert (which can still be named). */
export function offeredScenarioIds(): string[] {
  return scenarioIds().filter((id) => loadScenario(id).status !== "inert");
}

/** The scenarios a description names: one, a list, or several in one text ("wet-year+lean-council", or with commas). */
export function namedScenarios(named: unknown): string[] {
  const list = Array.isArray(named) ? named : named === undefined || named === null || named === false ? [] : String(named).split(/[+,]/);
  return list.map((x) => String(x).trim()).filter(Boolean);
}

/** The month (1 to 12) a season starts in, by a climate. */
export function seasonStart(C: NonNullable<Profile["values"]["climate"]>, season: NonNullable<Scenario["season"]>["starts_in"]): number {
  if (season === "hot_months") {
    const hot = new Set(C.summer_months);
    for (let m = 1; m <= 12; m++) if (hot.has(m) && !hot.has(((m + 10) % 12) + 1)) return m;
    return C.summer_months[0] ?? 1;
  }
  const half = (m: number) => Array.from({ length: 6 }, (_, k) => C.rain_by_month_bps[(m - 1 + k) % 12] ?? 10_000).reduce((a, b) => a + b, 0);
  let best = 1;
  for (let m = 2; m <= 12; m++) if (season === "wet_half" ? half(m) > half(best) : half(m) < half(best)) best = m;
  return best;
}

const changed = (was: number, c: ScenarioChange): number => {
  const to = c.set !== undefined ? c.set : c.times_bps !== undefined ? (was * c.times_bps) / 10_000 : 10_000 - ((10_000 - was) * c.shortfall_times_bps!) / 10_000;
  // (A whole number stays whole; a figure given with a fraction keeps four places.)
  return Number.isInteger(was) || c.set !== undefined ? Math.round(to) : Math.round(to * 10_000) / 10_000;
};

/**
 * A town's description and its profile with the scenarios the description names applied, in the order named: multiples
 * multiply; two scenarios that set the same thing differently, or each choose the weather or the season, don't go
 * together, and it says so. With none named (or only ones that change nothing) both come back as they were given.
 */
export function applyScenarios<T extends { scenario?: unknown }>(town: T, profile: Profile): { town: T; profile: Profile; weather?: WeatherChoice; applied: string[] } {
  const all = namedScenarios(town.scenario).map(loadScenario);
  const scenarios = all.filter((s) => s.changes?.length || s.season || s.weather || s.capability);
  if (!scenarios.length) return { town, profile, applied: [] };
  const t: any = structuredClone(town);
  const P = structuredClone(profile);
  const setBy = new Map<string, { value: string; by: string }>();
  const once = (what: string, value: unknown, by: string) => {
    const was = setBy.get(what);
    if (was && was.value !== JSON.stringify(value)) throw new Error(`scenarios ${was.by} and ${by} don't go together: each sets ${what}`);
    setBy.set(what, { value: JSON.stringify(value), by });
  };
  let weather: WeatherChoice | undefined;
  for (const s of scenarios) {
    if (s.capability) {
      const { basis: _, ...cap } = s.capability;
      once("the outside world's capability", cap, s.id);
      t.capability = cap;
    }
    for (const c of s.changes ?? []) {
      const at = `${c.in}.${c.path}`;
      if (c.in === "town") {
        if (c.add) {
          const a = c.add as { kind: string; what: string };
          once(`the world market's ${a.what} for ${a.kind}`, c.add, s.id);
          if (!(t.shocks ?? []).some((x: unknown) => JSON.stringify(x) === JSON.stringify(c.add))) t.shocks = [...(t.shocks ?? []), c.add];
          continue;
        }
        if (c.set !== undefined) once(at, c.set, s.id);
        else if (typeof t[c.path] !== "number") fail(s.id, `the town's description gives no ${c.path} to take a multiple of`);
        let to = changed(t[c.path], c);
        if (c.path.endsWith("_bps")) to = Math.max(0, Math.min(10_000, to));
        else if (c.set === undefined && t[c.path] >= 1) to = Math.max(1, to); // (a count: fewer, never none)
        t[c.path] = to;
        continue;
      }
      // A figure of the profile: found by its path; a profile that doesn't describe it can't be put under this scenario.
      const keys = c.path.split(".");
      let o: any = P.values;
      for (const k of keys.slice(0, -1)) o = o?.[k];
      const last = keys.at(-1)!;
      if (o === undefined || o === null || o[last] === undefined) fail(s.id, `the profile ${P.id} has no ${c.path} (it doesn't describe what this scenario changes)`);
      if (c.where) {
        if (!Array.isArray(o[last])) fail(s.id, `${at} is no list of rows`);
        const rows = (o[last] as Record<string, any>[]).filter((r) => typeof r[c.where!.field] === "number" && (c.where!.at_least === undefined || r[c.where!.field] >= c.where!.at_least) && (c.where!.at_most === undefined || r[c.where!.field] <= c.where!.at_most));
        if (!rows.length) fail(s.id, `${at} has no row with ${c.where.field} in the bounds given`);
        if (c.set !== undefined) once(`${at} (${JSON.stringify(c.where)}).${c.of}`, c.set, s.id);
        for (const r of rows) {
          if (typeof r[c.of!] !== "number") fail(s.id, `${at}: a row has no number ${c.of}`);
          r[c.of!] = changed(r[c.of!], c);
        }
        continue;
      }
      if (typeof o[last] !== "number") fail(s.id, `${at} is no number`);
      if (c.set !== undefined) once(at, c.set, s.id);
      o[last] = changed(o[last], c);
    }
    if (s.season) {
      if (!P.values.climate) fail(s.id, `the profile ${P.id} has no climate (a season is the climate's)`);
      once("the season the run starts in", s.season.starts_in, s.id);
      t.start_month = seasonStart(P.values.climate!, s.season.starts_in);
    }
    if (s.weather) {
      if (!P.values.climate) fail(s.id, `the profile ${P.id} has no climate (the weather is drawn from it)`);
      const { basis: _, ...choice } = s.weather;
      once("which of the climate's years the run is given", choice, s.id);
      weather = choice;
    }
  }
  return { town: t as T, profile: P, ...(weather ? { weather } : {}), applied: scenarios.map((s) => s.id) };
}
