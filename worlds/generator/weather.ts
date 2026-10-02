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
