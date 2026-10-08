// The before/after diff (docs/design/rebuild.md 8.4): two batches of the same world, measured the same way, and every
// measure compared. Several runs a side: a difference is judged against how much the measure varies from run to run
// (flagged beyond three standard errors). One run a side: the relative change, flagged beyond a tenth.
//
// What the runs of a side are decides what that noise is, and the diff says it (`drawn`): runs of ONE town (a batch's
// `--seeds N`) differ only in what happened there, so a difference is judged for that town alone; runs of several
// towns (`--towns T`) differ in who lives there too, and only those say anything of towns in general.

import { query, runQuery } from "./index";

/** What a folder's runs are: how many, of how many different towns, and how many runs of each town (in no order). */
export interface Drawn { runs: number; towns?: number; perTown?: number[] }

/**
 * The towns among a folder's runs, told apart by who was there at the start (everyone the world began with, and when
 * each was born): two runs of one generated town have the same people; two towns never do. Read from the measurement
 * tables, so it is what was run, whatever a manifest says. (`towns` absent: tables too old to tell.)
 */
export async function drawn(dir: string): Promise<Drawn> {
  const runs = Number((await query(dir, "select count(*) as n from runs"))[0]?.n ?? 0);
  try {
    const rows = await query(dir, `
      with made as (
        select run_id, json_extract_string(body, '$.entity') as entity from events where event = 'entity_created'
        union all select run_id, person from life where event = 'person_created'),
      first as (select e.run_id, e.entity, e.born_at from entities e where e.created_t = 0 and not exists (select 1 from made m where m.run_id = e.run_id and m.entity = e.entity)),
      town as (select run_id, md5(string_agg(entity || ':' || coalesce(cast(born_at as varchar), ''), ',' order by entity)) as town from first group by run_id)
      select town, count(*) as n from town group by town order by n desc, town`);
    return { runs, towns: rows.length, perTown: rows.map((r) => Number(r.n)) };
  } catch {
    return { runs };
  }
}

/** A side in words: "6 runs: 3 towns, 2 runs of each". */
export function drawnText(d: Drawn): string {
  const runs = `${d.runs} run${d.runs === 1 ? "" : "s"}`;
  if (d.towns === undefined || !d.perTown?.length) return `${runs} (of how many towns: not known from these tables)`;
  const [lo, hi] = [Math.min(...d.perTown), Math.max(...d.perTown)];
  if (d.towns === 1) return `${runs} of 1 town`;
  return `${runs}: ${d.towns} towns, ${lo === hi ? `${lo} run${lo === 1 ? "" : "s"}` : `${lo} to ${hi} runs`} of each`;
}

/** The measures compared by default: the town's calibration measures and its health. */
export const DIFF_QUERIES = ["economy/summary", "cast", "town/economy", "town/households", "town/rent-stress", "town/gatherings", "town/beliefs"];

export interface DiffRow {
  query: string;
  /** The row's key within a run (e.g. a teacher), if it has one. */
  key: string;
  measure: string;
  base: number;
  change: number;
  /** Runs on each side. */
  n: [number, number];
  /** Standard errors apart (several runs a side), or the relative change (one run a side). */
  z?: number;
  relative?: number;
  flagged: boolean;
}

/** Columns that say which row within a run it is (a teacher, a kind of actor, a month); other text isn't compared. */
const KEY_COLUMNS = new Set(["teacher", "who", "refusal", "via", "participant", "addressee", "subject", "purpose", "model", "kind", "month", "domain", "event"]);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const variance = (xs: number[]) => (xs.length < 2 ? 0 : xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));

/** Rows by (key, measure): each run's value. */
function collect(rows: Record<string, unknown>[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const keyCols = Object.entries(r).filter(([k]) => KEY_COLUMNS.has(k));
    const key = keyCols.map(([, v]) => String(v)).join(" ");
    for (const [k, v] of Object.entries(r)) {
      if (k === "run_id" || k === "seed") continue;
      const x = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined;
      if (x === undefined) continue;
      const id = `${key}\u0000${k}`;
      out.set(id, [...(out.get(id) ?? []), x]);
    }
  }
  return out;
}

export async function diff(baseDir: string, changeDir: string, names: string[] = DIFF_QUERIES): Promise<DiffRow[]> {
  const out: DiffRow[] = [];
  for (const query of names) {
    const [a, b] = [collect(await runQuery(baseDir, query)), collect(await runQuery(changeDir, query))];
    for (const [id, xs] of a) {
      const ys = b.get(id);
      if (!ys) continue;
      const [key, measure] = id.split("\u0000") as [string, string];
      const [ma, mb] = [mean(xs), mean(ys)];
      const row: DiffRow = { query, key, measure, base: ma, change: mb, n: [xs.length, ys.length], flagged: false };
      if (xs.length > 1 && ys.length > 1) {
        const se = Math.sqrt(variance(xs) / xs.length + variance(ys) / ys.length);
        row.z = se > 0 ? (mb - ma) / se : ma === mb ? 0 : Infinity * Math.sign(mb - ma);
        row.flagged = Math.abs(row.z) > 3;
      } else {
        row.relative = ma !== 0 ? (mb - ma) / Math.abs(ma) : mb === 0 ? 0 : Infinity;
        row.flagged = Math.abs(row.relative) > 0.1 && Math.abs(mb - ma) > 1;
      }
      out.push(row);
    }
  }
  const size = (r: DiffRow) => Math.abs(r.z ?? (r.relative ?? 0) * 10);
  return out.sort((x, y) => Number(y.flagged) - Number(x.flagged) || size(y) - size(x));
}

/** The diff in words: what was compared (how many towns, how many runs of each), flagged moves first, then the rest
 * (the largest first). */
export function diffText(rows: DiffRow[], sides?: [Drawn, Drawn]): string {
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  const line = (r: DiffRow) => `${r.flagged ? "!" : " "} ${r.query.padEnd(18)} ${`${r.key ? r.key + " " : ""}${r.measure}`.padEnd(40)} ${f(r.base).padStart(12)} -> ${f(r.change).padEnd(12)} ${r.z !== undefined ? `z ${r.z.toFixed(1)}` : `${((r.relative ?? 0) * 100).toFixed(1)}%`}`;
  const flagged = rows.filter((r) => r.flagged);
  const oneTown = sides?.some((d) => d.towns === 1 && d.runs > 1);
  return [
    ...(sides ? [`Baseline: ${drawnText(sides[0])}. Change: ${drawnText(sides[1])}.`] : []),
    ...(oneTown ? ["  One town run several times: its runs differ in what happened, not in who lives there, so the noise below is that town's alone. For towns in general, run several (oikos run --towns N)."] : []),
    `${rows.length} measures compared (${rows[0] ? `${rows[0].n[0]} run${rows[0].n[0] === 1 ? "" : "s"} against ${rows[0].n[1]}` : "none"}); ${flagged.length} moved beyond ${rows[0]?.z !== undefined ? "the noise between runs (3 standard errors)" : "a tenth"}.`,
    ...rows.map(line),
  ].join("\n");
}
