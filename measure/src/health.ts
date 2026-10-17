// The health report (docs/design/rebuild.md 8.4): a batch's measures against its profile's calibration targets, each
// within a stated tolerance, and signs of trouble that don't stop a run. Breaches first. The targets are the profile's
// (a place's figures, with sources); which measure answers each, and how close counts as close, are measurement's.

import { drawnText, type Drawn } from "./diff";
import { runQuery } from "./index";

export interface Target {
  what: string;
  value: number;
  source?: string;
}

/** Which measure answers a target, and the tolerance (in the measure's own units) inside which it isn't a breach. */
export const TARGET_MEASURES: { what: string; query: string; column: string; key?: RegExp; tolerance: number }[] = [
  { what: "employment_to_population_pct", query: "economy/summary", column: "employment_to_population_pct", tolerance: 3 },
  { what: "unemployment_rate_pct", query: "economy/summary", column: "unemployment_pct", tolerance: 1.5 },
  { what: "participation_rate_pct", query: "economy/summary", column: "participation_pct", tolerance: 3 },
  { what: "household_saving_ratio_pct", query: "economy/summary", column: "people_saving_pct", tolerance: 5 },
  // (Informal employment, as each place's profile names its target: docs/measurement.md, "Employment".)
  { what: "informal_share_of_employment_pct", query: "economy/work", column: "informal_employment_pct", tolerance: 5 },
  { what: "informal_employment_pct", query: "economy/work", column: "informal_employment_pct", tolerance: 5 },
  { what: "own_account_share_of_employment_pct", query: "economy/work", column: "own_account_pct", tolerance: 5 },
  { what: "renters_housing_costs_share_of_income_pct", query: "town/rent-stress", column: "median_rent_pct", tolerance: 3 },
  // (Business births and deaths a year, as shares of the businesses there were at its start: the measure's own definition, docs/calibration.md.)
  { what: "business_entry_rate_pct", query: "economy/businesses", column: "birth_rate_pct", tolerance: 5 },
  { what: "business_exit_rate_pct", query: "economy/businesses", column: "death_rate_pct", tolerance: 5 },
  // (Of people in a job at the end, the share in a job with another employer at some time in the year before.)
  { what: "job_mobility_pct_of_employed_per_year", query: "economy/job-mobility", column: "job_mobility_pct", tolerance: 3 },
  { what: "tenancy_tribunal_applications_per_1000_renting_households_per_year", query: "town/possession", column: "applications_per_1000", tolerance: 30 },
  // (Affiliation as a census asks it, of the religious teacher's group, not the firmly-held share.)
  { what: "christian_share_pct", query: "town/beliefs", column: "affiliated_last_pct", key: /^religious-/, tolerance: 10 },
  { what: "social_group_participation_pct", query: "town/gatherings", column: "took_part_pct", tolerance: 5 },
  // (A teacher whose group is of the religious kind: its generated id says so.)
  { what: "religious_affiliation_change_pts_per_year", query: "town/beliefs", column: "affiliated_change_per_year", key: /^religious-/, tolerance: 1 },
];

export interface HealthRow {
  what: string;
  /** The mean over the batch's runs, and the lowest and highest. */
  measured?: { mean: number; low: number; high: number; runs: number };
  target?: number;
  tolerance?: number;
  source?: string;
  breach: boolean;
  note?: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export async function health(dir: string, targets: Target[]): Promise<HealthRow[]> {
  const rows: HealthRow[] = [];
  const cache = new Map<string, Record<string, unknown>[]>();
  const q = async (name: string) => cache.get(name) ?? (cache.set(name, await runQuery(dir, name)), cache.get(name)!);
  for (const t of targets) {
    const m = TARGET_MEASURES.find((x) => x.what === t.what);
    if (!m) {
      rows.push({ what: t.what, target: t.value, source: t.source, breach: false, note: "not measured yet" });
      continue;
    }
    const values = (await q(m.query)).filter((r) => !m.key || Object.values(r).some((v) => typeof v === "string" && m.key!.test(v))).map((r) => num(r[m.column])).filter((x): x is number => x !== undefined);
    if (!values.length) {
      rows.push({ what: t.what, target: t.value, source: t.source, breach: false, note: "no runs measured it" });
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    rows.push({ what: t.what, measured: { mean, low: Math.min(...values), high: Math.max(...values), runs: values.length }, target: t.value, tolerance: m.tolerance, source: t.source, breach: Math.abs(mean - t.value) > m.tolerance });
  }
  // Demand that went unmet: what households wanted and didn't get, over the runs (more than 5% is a sign).
  const monthly = await q("economy/monthly");
  // (Of the orders that were settled: one still being served when the log ends is neither met nor unmet.)
  const wanted = monthly.reduce((a, r) => a + (num(r.wanted) ?? 0) - (num(r.pending) ?? 0), 0);
  const without = monthly.reduce((a, r) => a + (num(r.went_without) ?? 0), 0);
  if (wanted > 0) {
    const pct = (100 * without) / wanted;
    rows.push({ what: "demand_unmet_pct", measured: { mean: pct, low: pct, high: pct, runs: 1 }, tolerance: 5, breach: pct > 5, note: "what households ordered and went without" });
  }
  return rows.sort((a, b) => Number(b.breach) - Number(a.breach));
}

/** The report in words; with `over`, what it is a report of (how many towns, how many runs of each). */
export function healthText(rows: HealthRow[], over?: Drawn): string {
  const f = (x: number) => (Math.abs(x) >= 100 || Number.isInteger(x) ? x.toFixed(0) : x.toFixed(2));
  const breaches = rows.filter((r) => r.breach).length;
  return [
    `Health: ${breaches ? `${breaches} breach${breaches === 1 ? "" : "es"}` : "no breaches"} of ${rows.length} measures${over ? `, over ${drawnText(over)}` : ""}.`,
    ...(over?.towns === 1 && over.runs > 1 ? ["  One town run several times: the ranges below are that town's from run to run, not the range over towns (oikos run --towns N for that)."] : []),
    ...rows.map((r) =>
      `${r.breach ? "!" : " "} ${r.what.padEnd(44)} ${r.measured ? `${f(r.measured.mean)}${r.measured.runs > 1 ? ` (${f(r.measured.low)} to ${f(r.measured.high)}, ${r.measured.runs} runs)` : ""}` : "-"}`.padEnd(100) +
      (r.target !== undefined ? `target ${f(r.target)}${r.tolerance !== undefined ? ` ± ${f(r.tolerance)}` : ""}` : r.tolerance !== undefined ? `at most ${f(r.tolerance)}` : "") +
      (r.note ? `  (${r.note})` : ""),
    ),
  ].join("\n");
}
