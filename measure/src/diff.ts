// The before/after diff (docs/design/rebuild.md 8.4): two batches of the same world and seeds, measured the same way,
// and every measure compared. Several seeds a side: a difference is judged against how much the measure varies from
// seed to seed (flagged beyond three standard errors). One seed a side: the relative change, flagged beyond a tenth.

import { runQuery } from "./index";

/** The measures compared by default: the town's calibration measures and its health. */
export const DIFF_QUERIES = ["economy/summary", "cast", "town/economy", "town/households", "town/rent-stress", "town/gatherings", "town/beliefs"];

export interface DiffRow {
  query: string;
  /** The row's key within a run (e.g. a teacher), if it has one. */
  key: string;
  measure: string;
  base: number;
  change: number;
  /** Seeds on each side. */
  n: [number, number];
  /** Standard errors apart (several seeds), or the relative change (one seed). */
  z?: number;
  relative?: number;
  flagged: boolean;
}

/** Columns that say which row within a run it is (a teacher, a kind of actor, a month); other text isn't compared. */
const KEY_COLUMNS = new Set(["teacher", "who", "refusal", "via", "participant", "addressee", "subject", "purpose", "model", "kind", "month", "domain", "event"]);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const variance = (xs: number[]) => (xs.length < 2 ? 0 : xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));

/** Rows by (key, measure): each seed's value. */
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

/** The diff in words: flagged moves first, then the rest (the largest first). */
export function diffText(rows: DiffRow[]): string {
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  const line = (r: DiffRow) => `${r.flagged ? "!" : " "} ${r.query.padEnd(18)} ${`${r.key ? r.key + " " : ""}${r.measure}`.padEnd(40)} ${f(r.base).padStart(12)} -> ${f(r.change).padEnd(12)} ${r.z !== undefined ? `z ${r.z.toFixed(1)}` : `${((r.relative ?? 0) * 100).toFixed(1)}%`}`;
  const flagged = rows.filter((r) => r.flagged);
  return [
    `${rows.length} measures compared (${rows[0] ? `${rows[0].n[0]} seed${rows[0].n[0] === 1 ? "" : "s"} against ${rows[0].n[1]}` : "none"}); ${flagged.length} moved beyond ${rows[0]?.z !== undefined ? "seed noise (3 standard errors)" : "a tenth"}.`,
    ...rows.map(line),
  ].join("\n");
}
