// The researcher workbench's server side (docs/explorer.md, "The workbench"): which runs belong together (an
// experiment's arms and seeds, a fork and its parent), the measures of stewardship over time read from each run's log by
// measure/'s own Ledger, and exports of any table to CSV or Parquet. Read-only: logs are read through orchestrator's
// readers, nothing is written anywhere, and nothing is fed back into a run. Measures are computed here, on the server,
// never in the browser; the events table and cohorts are the Rust data layer's (kernel/crates/explore/src/bench.rs).
//
// Debriefs are not shown in this build (VISION 15): the index drops them, and nothing here reads them. `DEBRIEF_HOOK`
// names where a separate, deliberate view would plug in; its design is the owner's to decide.

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parquetWriteBuffer } from "hyparquet-writer";
import { logLines } from "../../orchestrator/src/logs";
import { Ledger, STEWARDSHIP_MEASURES, type Institutions } from "../../measure/src/stewardship";
import { parsePrereg } from "../../measure/src/prereg";
import type { RunEntry } from "./paths";

const DAY = 86_400;

/** Where a deliberate view of seats' debriefs would plug in, if the owner decides to build one (VISION 15). Nothing
 * reads debriefs now: the explorer's index drops them, and this build has no route that serves them. */
export const DEBRIEF_HOOK = { route: null as string | null, note: "not built: a separate, deliberate view, its design the owner's to decide (VISION 15)" };

export interface Group { experiment: string; dir: string; arm?: string; seed?: number; reference?: string; registered?: Registered }
export interface Registered { file: string; primary: { measure: string; arm?: string; vs?: string; did?: string[]; expect?: string }[]; secondary: { measure: string; arm?: string; vs?: string }[]; question?: string; registered?: string }
export interface RunInfo { key: string; name: string; dir: string; log: string; group?: Group; parent?: string }

/** The experiment a run belongs to, from where its log sits: an exported arm of an experiment's output
 * (`<exp>/seed-N/<arm>.jsonl`, `oikos-kernel export`, docs/experiments.md) or a folder that names it in `experiment.json`
 * (`{experiment: <its output folder>, arm, seed}`), for arms exported elsewhere. */
export function groupOf(entry: RunEntry): Group | undefined {
  const log = entry.log ?? entry.dir;
  const near = [dirname(log), dirname(dirname(log)), entry.dir, dirname(entry.dir)];
  for (const d of near) {
    const manifest = join(d, "experiment.json");
    if (existsSync(manifest)) {
      try {
        const m = JSON.parse(readFileSync(manifest, "utf8"));
        const dir = m.experiment ? join(d, m.experiment) : d;
        return withSpec({ experiment: m.name ?? basename(dir), dir, arm: m.arm, seed: m.seed });
      } catch { /* (not one) */ }
    }
  }
  const seedDir = dirname(log), expDir = dirname(seedDir);
  const seed = /^seed-(\d+)$/.exec(basename(seedDir))?.[1];
  if (seed && existsSync(join(expDir, "spec.json"))) return withSpec({ experiment: basename(expDir), dir: expDir, arm: basename(log).replace(/\.jsonl(\.zst)?$/, ""), seed: Number(seed) });
  return undefined;
}

function withSpec(g: Group): Group {
  const spec = readJson(join(g.dir, "spec.json"));
  if (spec) { g.experiment = spec.name ?? g.experiment; g.reference = spec.reference; }
  g.registered = registrationOf(g.dir, spec);
  return g;
}

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; } }

/** The pre-registration kept with an experiment's results (the harness keeps a copy beside them), if it has one. */
export function registrationOf(dir: string, spec?: any): Registered | undefined {
  const names = [spec?.preregistration && basename(spec.preregistration), "preregistration.yaml", "preregistration.json", "prereg.yaml", "prereg.json"].filter(Boolean) as string[];
  for (const n of names) {
    const p = join(dir, n);
    if (!existsSync(p)) continue;
    try {
      const r: any = parsePrereg(readFileSync(p, "utf8"), p);
      return { file: p, primary: r.primary ?? [], secondary: r.secondary ?? [], question: r.question, registered: r.registered };
    } catch { /* (unreadable: shown as unregistered) */ }
  }
  return undefined;
}

export function describeRuns(runs: RunEntry[]): RunInfo[] {
  return runs.map((r) => ({ key: r.key, name: r.name, dir: r.dir, log: r.log ?? r.dir, group: groupOf(r) }));
}

export interface Series { version: string; days: number; defs: typeof STEWARDSHIP_MEASURES; series: { [name: string]: (number | null)[] }; seconds: number }

/** The measures of stewardship over time: the log read once by a Ledger, its result taken at each midnight (so day d's
 * value is the measure from the window's start to that midnight: counts accumulate, shares and means are to date). */
export async function measureSeries(log: string, o: { institutions?: Institutions; from?: number } = {}): Promise<Series> {
  const started = performance.now();
  const ledger = new Ledger({ institutions: o.institutions, from: o.from });
  const series: Series["series"] = {};
  for (const d of STEWARDSHIP_MEASURES) series[d.name] = [];
  let day = 0;
  const take = () => { const m = ledger.result().measures; for (const d of STEWARDSHIP_MEASURES) series[d.name]!.push(m[d.name] ?? null); };
  for await (const line of logLines(log)) {
    if (!line) continue;
    const t = numberAfter(line, '"t":');
    while (t !== undefined && t >= (day + 1) * DAY) { take(); day++; }
    ledger.see(JSON.parse(line));
  }
  take();
  return { version: "1", days: day, defs: STEWARDSHIP_MEASURES, series, seconds: Math.round((performance.now() - started) / 100) / 10 };
}

function numberAfter(line: string, key: string): number | undefined {
  const i = line.indexOf(key);
  if (i < 0) return undefined;
  const n = Number.parseInt(line.slice(i + key.length, i + key.length + 16), 10);
  return Number.isFinite(n) ? n : undefined;
}

export type Table = { columns: string[]; rows: unknown[][] };

/** A table as CSV (RFC 4180: quoted where needed, CRLF between records). */
export function toCsv(t: Table): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns.map(cell).join(","), ...t.rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}

/** A table as Parquet (one row group; a column is a number if every value in it is, else text). */
export function toParquet(t: Table): Uint8Array {
  const columnData = t.columns.map((name, i) => {
    const vals = t.rows.map((r) => r[i]);
    const numeric = vals.every((v) => v === null || v === undefined || typeof v === "number");
    const ints = numeric && vals.every((v) => v === null || v === undefined || Number.isSafeInteger(v));
    return numeric
      ? { name, data: vals.map((v) => (v === undefined ? null : (ints && v !== null ? BigInt(v as number) : v))), type: ints ? "INT64" : "DOUBLE" }
      : { name, data: vals.map((v) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v))), type: "STRING" };
  });
  return new Uint8Array(parquetWriteBuffer({ columnData: columnData as any }));
}

/** How big a log is (for the workbench's run list). */
export function logBytes(log: string): number { try { return statSync(log).size; } catch { return 0; } }
