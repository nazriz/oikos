// Weather for a run (docs/behaviour/weather.md; docs/design/world-expansion.md 7.3), drawn from a profile's climate with
// the generator's seeded randomness: the river's inflow day by day (the season, heavy rain, drought) and heatwaves. It
// is config, fixed before the run like the town itself: the kernel scales the fields' sources by it (`source_by_day`),
// and the weather bureau warns of what's coming. Nothing in the world can change the weather.

import type { Profile } from "./profile";

type Climate = NonNullable<Profile["values"]["climate"]>;
export interface DayStep { from_day: number; bps: number }
export interface WeatherEvent { kind: "heavy_rain" | "drought" | "heatwave"; from_day: number; days: number }

const MONTH_DAYS = 365 / 12;

/** Steps from a value for each day: a step wherever the value changes (at most `max`, the contract's limit). */
function steps(daily: number[], max = 1000): DayStep[] {
  const out: DayStep[] = [];
  daily.forEach((bps, day) => {
    if (!out.length || out.at(-1)!.bps !== bps) out.push({ from_day: day, bps });
  });
  return out.slice(0, max);
}

/**
 * The weather for `days` days of a run starting in `startMonth` (1 = January): `rain`, the river's inflow (10,000 = the
 * year's usual); `heat`, 10,000 on heatwave days and 0 otherwise; and the events, for the weather bureau's warnings.
 */
export function drawWeather(C: Climate, days: number, below: (n: number) => number, startMonth = 1) {
  const monthOf = (day: number) => (startMonth - 1 + Math.floor(day / MONTH_DAYS)) % 12;
  const between = ([lo, hi]: [number, number]) => lo + below(hi - lo + 1);
  const events: WeatherEvent[] = [];
  const rain = Array.from({ length: days }, (_, d) => C.rain_by_month_bps[monthOf(d)] ?? 10_000);
  const heat = Array.from({ length: days }, () => 0);
  // Drought: drawn at each year's start; while it lasts, the river gets the drought's share of what the season brings.
  for (let y = 0; y * 365 < days; y++) {
    if (below(10_000) >= C.drought_bps_per_year) continue;
    const from = y * 365 + below(365);
    const len = Math.round(between(C.drought_months) * MONTH_DAYS);
    if (from >= days) continue;
    events.push({ kind: "drought", from_day: from, days: len });
    for (let d = from; d < Math.min(days, from + len); d++) rain[d] = Math.floor((rain[d]! * C.drought_bps) / 10_000);
  }
  // Heavy rain: a month's chance of a spell, on a day within it.
  for (let m = 0; m * MONTH_DAYS < days; m++) {
    if (below(10_000) >= C.storm_bps_per_month) continue;
    const from = Math.floor(m * MONTH_DAYS) + below(Math.floor(MONTH_DAYS));
    const len = between(C.storm_days);
    if (from >= days) continue;
    events.push({ kind: "heavy_rain", from_day: from, days: len });
    for (let d = from; d < Math.min(days, from + len); d++) rain[d] = Math.floor((rain[d]! * C.storm_bps) / 10_000);
  }
  // Heatwaves: each summer week's chance.
  for (let w = 0; w * 7 < days; w++) {
    if (!C.summer_months.includes(monthOf(w * 7) + 1) || below(10_000) >= C.heatwave_bps_per_week) continue;
    const from = w * 7 + below(7);
    const len = between(C.heatwave_days);
    if (from >= days) continue;
    events.push({ kind: "heatwave", from_day: from, days: len });
    for (let d = from; d < Math.min(days, from + len); d++) heat[d] = 10_000;
  }
  events.sort((a, b) => a.from_day - b.from_day || (a.kind < b.kind ? -1 : 1));
  return { rain: steps(rain), heat: steps(heat), events };
}

/**
 * Which of the climate's own years a run is given (docs/scenarios.md): `draws` weathers are drawn from the climate,
 * ranked by a measure over the run's first `over_days` days, and the one at `percentile` is the run's (99: the
 * highest in a hundred; 5: among the lowest in twenty). Nothing of the climate is changed: the year is one the
 * climate gives, as often as its percentile says.
 */
export interface WeatherChoice {
  /** wettest_spell: the most the river is sent in any five days running. inflow: what it is sent in all.
   * heatwave_days: the days of heatwave. */
  rank_by: "wettest_spell" | "inflow" | "heatwave_days";
  percentile: number;
  draws: number;
  over_days: number;
}

/** A value for each day from steps. */
function daily(s: DayStep[], days: number): number[] {
  const out: number[] = [];
  let i = 0, v = 0;
  for (let d = 0; d < days; d++) {
    while (i < s.length && s[i]!.from_day <= d) v = s[i++]!.bps;
    out.push(v);
  }
  return out;
}

/** A weather's measure over its first days (what `WeatherChoice` ranks by). */
export function weatherMeasure(w: { rain: DayStep[]; heat: DayStep[] }, by: WeatherChoice["rank_by"], overDays: number): number {
  if (by === "heatwave_days") return daily(w.heat, overDays).filter((x) => x > 0).length;
  const rain = daily(w.rain, overDays);
  if (by === "inflow") return rain.reduce((a, b) => a + b, 0);
  const SPELL = 5;
  let best = 0, sum = 0;
  rain.forEach((x, d) => {
    sum += x - (d >= SPELL ? rain[d - SPELL]! : 0);
    if (sum > best) best = sum;
  });
  return best;
}

/** The weather at a percentile of the climate's own draws: `stream(i)` is the seeded randomness of the i-th draw. */
export function chooseWeather(C: Climate, days: number, stream: (i: number) => (n: number) => number, startMonth: number, choice: WeatherChoice) {
  const over = Math.min(days, choice.over_days);
  const drawn = Array.from({ length: choice.draws }, (_, i) => {
    const w = drawWeather(C, days, stream(i), startMonth);
    return { w, i, measure: weatherMeasure(w, choice.rank_by, over) };
  }).sort((a, b) => a.measure - b.measure || a.i - b.i);
  return drawn[Math.round((choice.percentile * (drawn.length - 1)) / 100)]!.w;
}
