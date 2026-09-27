// Measurement: outside the world, reading its logs (CLAUDE.md: the platform
// doesn't judge outcomes; measurement lives outside and reads logs).
//
// A run's log (JSONL, hash-chained) is exported to Parquet tables, one file
// per run per table, so a batch is just a folder: DuckDB queries every run in
// it together. Tables are plain facts from the log (who did what, what
// happened, what it cost), never judgements. Queries (measure/queries) are
// descriptive: counts, sums and shares that a researcher reads.
//
// Tables and their columns are documented in docs/measurement.md.

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

export const MEASURE_VERSION = "0.1.1";

const QUERY_DIR = join(import.meta.dir, "../queries");

/** Each table: how it's made from `raw` (the log, one row per entry) for one run. `$run` is the run id. */
const TABLES: { [name: string]: string } = {
  runs: `
    select $run as run_id,
      (json_extract_string(h.body, '$.config.seed'))::BIGINT as seed,
      json_extract_string(h.body, '$.config.meta.name') as world,
      json_extract_string(h.body, '$.contracts') as contracts,
      json_extract_string(h.body, '$.config_hash') as config_hash,
      json_extract_string(h.body, '$.kernel.version') as kernel_version,
      json_extract_string(h.body, '$.kernel.build') as kernel_build,
      (json_extract_string(h.body, '$.config.clock.run_seconds'))::BIGINT as run_seconds,
      json_extract_string(e.body, '$.reason') as end_reason, e.t as end_t, json_extract_string(e.body, '$.state_hash') as state_hash,
      (select count(*) from raw) as entries,
      (select json_extract_string(a.body, '$.data.version') from raw a where a.kind = 'annotation' and json_extract_string(a.body, '$.annotation') = 'orchestrator' limit 1) as orchestrator_version
    from raw h, raw e where h.kind = 'header' and e.kind = 'end'`,
  seats: `
    select $run as run_id, json_extract_string(s, '$.id') as seat, json_extract_string(s, '$.entity') as entity, k.kind as entity_kind,
      json_extract_string(s, '$.title') as title, json_extract_string(s, '$.role') as role,
      json_extract_string(s, '$.controller.type') as controller, json_extract_string(s, '$.controller.impl') as impl, json_extract_string(s, '$.controller.model') as model,
      json_extract_string(o.body, '$.data.llm.seats."' || json_extract_string(s, '$.id') || '".adapter') as adapter,
      json_extract_string(o.body, '$.data.llm.seats."' || json_extract_string(s, '$.id') || '".configured') as configured
    from (select unnest(from_json(json_extract(body, '$.config.seats'), '["JSON"]')) as s from raw where kind = 'header')
    left join (select body from raw where kind = 'annotation' and json_extract_string(body, '$.annotation') = 'orchestrator' limit 1) o on true
    left join (select json_extract_string(e, '$.id') as id, json_extract_string(e, '$.kind') as kind
      from (select unnest(from_json(json_extract(body, '$.config.world.entities'), '["JSON"]')) as e from raw where kind = 'header')) k on k.id = json_extract_string(s, '$.entity')`,
  events: `
    select $run as run_id, seq, t, json_extract_string(body, '$.event') as event, (json_extract_string(body, '$.cause'))::UBIGINT as cause, body
    from raw where kind = 'event'`,
  transfers: `
    select $run as run_id, seq, t, json_extract_string(body, '$.from') as "from", json_extract_string(body, '$.to') as "to", (json_extract_string(body, '$.amount'))::BIGINT as amount,
      json_extract_string(body, '$.reason') as reason, json_extract_string(body, '$.by') as "by", json_extract_string(body, '$.settles') as settles, json_extract_string(body, '$.per_instruction') as per_instruction, json_extract_string(body, '$.memo') as memo
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'transfer'`,
  // A departure's slot and count are the ones its occupant arrived into (the kernel's vacate removes the occupant, whatever it held).
  occupancy: `
    select run_id, seq, t, event, occupant, structure,
      coalesce(slot, last_value(slot ignore nulls) over w) as slot, coalesce(count, last_value(count ignore nulls) over w) as count, reason, "by"
    from (
      select $run as run_id, seq, t, json_extract_string(body, '$.event') as event, json_extract_string(body, '$.occupant') as occupant, json_extract_string(body, '$.structure') as structure,
        json_extract_string(body, '$.slot') as slot, (json_extract_string(body, '$.count'))::INTEGER as count, json_extract_string(body, '$.reason') as reason, json_extract_string(body, '$.by') as "by"
      from raw where kind = 'event' and json_extract_string(body, '$.event') in ('occupied', 'vacated')
      union all
      select $run, 0, 0, 'occupied', json_extract_string(o, '$.occupant'), json_extract_string(o, '$.structure'), json_extract_string(o, '$.slot'),
        (json_extract_string(o, '$.count'))::INTEGER, null, 'genesis'
      from (select unnest(from_json(json_extract(body, '$.config.world.occupancy'), '["JSON"]')) as o from raw where kind = 'header'))
    window w as (partition by occupant, structure order by seq rows between unbounded preceding and current row)`,
  records: `
    select $run as run_id, seq, t, json_extract_string(r, '$.id') as id, json_extract_string(r, '$.record') as record, json_extract_string(r, '$.kind') as kind, json_extract_string(r, '$.author') as author,
      json_extract_string(r, '$.speaks_for') as speaks_for, (json_extract_string(r, '$.at'))::BIGINT as "at", json_extract_string(r, '$.basis') as basis, json_extract_string(r, '$.place') as place,
      json_extract_string(r, '$.terms.template') as template, json_extract_string(r, '$.withdraws') as withdraws, r as body
    from (select seq, t, json_extract(body, '$.record') as r from raw where kind = 'event' and json_extract_string(body, '$.event') = 'recorded')
    union all
    select $run, 0, 0, json_extract_string(r, '$.id'), json_extract_string(r, '$.record'), json_extract_string(r, '$.kind'), json_extract_string(r, '$.author'), json_extract_string(r, '$.speaks_for'), (json_extract_string(r, '$.at'))::BIGINT, json_extract_string(r, '$.basis'), json_extract_string(r, '$.place'),
      json_extract_string(r, '$.terms.template'), json_extract_string(r, '$.withdraws'), r
    from (select unnest(from_json(json_extract(body, '$.config.world.records'), '["JSON"]')) as r from raw where kind = 'header')`,
  commands: `
    select $run as run_id, seq, t, json_extract_string(body, '$.command') as command, json_extract_string(body, '$.seat') as seat, body
    from raw where kind = 'command' and json_extract_string(body, '$.command') <> 'observe'`,
  acts: `
    select $run as run_id, c.seq, c.t, json_extract_string(c.body, '$.seat') as seat, json_extract_string(c.body, '$.provenance.via') as via,
      json_array_length(json_extract(c.body, '$.blocks')) as blocks, json_extract_string(c.body, '$.reasoning') as reasoning,
      json_extract_string(o.body, '$.event') = 'action_applied' as applied, json_extract_string(o.body, '$.action') as action,
      json_extract_string(o.body, '$.code') as refusal, (json_extract_string(o.body, '$.block'))::INTEGER as refused_block, json_extract_string(o.body, '$.detail') as detail, json_extract(c.body, '$.blocks') as blocks_json
    from raw c left join raw o on o.kind = 'event' and (json_extract_string(o.body, '$.cause'))::UBIGINT = c.seq and json_extract_string(o.body, '$.event') in ('action_applied', 'action_refused')
    where c.kind = 'command' and json_extract_string(c.body, '$.command') = 'act'`,
  messages: `
    select $run as run_id, seq, t, seat, from_json(json_extract(b, '$.to'), '["VARCHAR"]') as "to", json_extract_string(b, '$.text') as text, json_extract_string(b, '$.re') as re
    from (select seq, t, json_extract_string(body, '$.seat') as seat, unnest(from_json(json_extract(body, '$.blocks'), '["JSON"]')) as b from raw where kind = 'command' and json_extract_string(body, '$.command') = 'act')
    where json_extract_string(b, '$.block') = 'message'`,
  annotations: `
    select $run as run_id, seq, t, json_extract_string(body, '$.annotation') as annotation, json_extract_string(body, '$.subject') as subject, body
    from raw where kind = 'annotation' and json_extract_string(body, '$.annotation') not in ('usage', 'transcript')`,
  usage: `
    select $run as run_id, seq, t, json_extract_string(body, '$.purpose') as purpose, json_extract_string(body, '$.subject') as subject, json_extract_string(body, '$.provider') as provider, json_extract_string(body, '$.model') as model,
      (json_extract_string(body, '$.input_tokens'))::BIGINT as input_tokens, (json_extract_string(body, '$.output_tokens'))::BIGINT as output_tokens,
      coalesce((json_extract_string(body, '$.cache_read_tokens'))::BIGINT, 0) as cache_read_tokens, coalesce((json_extract_string(body, '$.cache_write_tokens'))::BIGINT, 0) as cache_write_tokens,
      (json_extract_string(body, '$.cost_microusd'))::BIGINT as cost_microusd
    from raw where kind = 'annotation' and json_extract_string(body, '$.annotation') = 'usage'`,
  transcripts: `
    select $run as run_id, seq, t, json_extract_string(body, '$.subject') as subject, json_extract_string(body, '$.data.purpose') as purpose, json_extract(body, '$.data') as data
    from raw where kind = 'annotation' and json_extract_string(body, '$.annotation') = 'transcript'`,
};

export const TABLE_NAMES = Object.keys(TABLES);

const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;
const safe = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_");

async function connect(): Promise<DuckDBConnection> {
  return (await DuckDBInstance.create(":memory:")).connect();
}

/** Export run logs to Parquet tables under `outDir` (`<table>/<run_id>.parquet`). Replaces a run's files if they exist. */
export async function exportLogs(logs: string[], outDir: string): Promise<{ run: string; entries: number }[]> {
  const c = await connect();
  const done: { run: string; entries: number }[] = [];
  for (const table of TABLE_NAMES) mkdirSync(join(outDir, table), { recursive: true });
  for (const log of logs) {
    await c.run(`create or replace temp table raw as select * from read_json(${sqlString(log)}, format = 'newline_delimited', columns = {seq: 'UBIGINT', t: 'BIGINT', kind: 'VARCHAR', body: 'JSON'})`);
    const header = (await c.runAndReadAll(`select json_extract_string(body, '$.run_id') as run_id, (select count(*) from raw) as n from raw where kind = 'header'`)).getRowObjects()[0];
    if (!header) throw new Error(`${log}: no header entry`);
    const run = String(header.run_id);
    for (const [table, sql] of Object.entries(TABLES)) {
      const file = join(outDir, table, `${safe(run)}.parquet`);
      rmSync(file, { force: true });
      await c.run(`copy (${sql.replaceAll("$run", sqlString(run))}) to ${sqlString(file)} (format parquet, compression zstd)`);
    }
    done.push({ run, entries: Number(header.n) });
  }
  return done;
}

/** A connection with one view per table over every run exported to `dir`. */
export async function open(dir: string): Promise<DuckDBConnection> {
  const c = await connect();
  for (const table of TABLE_NAMES) {
    const d = join(dir, table);
    if (!existsSync(d) || !readdirSync(d).some((f) => f.endsWith(".parquet"))) continue;
    await c.run(`create view ${table} as select * from read_parquet(${sqlString(join(d, "*.parquet"))}, union_by_name = true)`);
  }
  return c;
}

/** Run SQL against the exported runs in `dir`. Integers come back as numbers where they fit exactly, otherwise as bigints. */
export async function query(dir: string, sql: string, c?: DuckDBConnection): Promise<Record<string, unknown>[]> {
  const conn = c ?? (await open(dir));
  return (await conn.runAndReadAll(sql)).getRowObjectsJS().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
}

const plain = (v: unknown): unknown =>
  typeof v === "bigint" ? (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v) : Array.isArray(v) ? v.map(plain) : v;

/** The standing queries: `measure/queries/**\/<name>.sql`, each starting with a `-- ` description line. */
export function queries(): { name: string; path: string; description: string }[] {
  const out: { name: string; path: string; description: string }[] = [];
  const walk = (d: string, prefix: string) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (f.isDirectory()) walk(join(d, f.name), `${prefix}${f.name}/`);
      else if (f.name.endsWith(".sql")) {
        const path = join(d, f.name);
        const first = readFileSync(path, "utf8").split("\n")[0] ?? "";
        out.push({ name: `${prefix}${basename(f.name, ".sql")}`, path, description: first.replace(/^--\s*/, "") });
      }
    }
  };
  walk(QUERY_DIR, "");
  return out;
}

/** Run a standing query by name. */
export async function runQuery(dir: string, name: string, c?: DuckDBConnection): Promise<Record<string, unknown>[]> {
  const q = queries().find((x) => x.name === name);
  if (!q) throw new Error(`no query "${name}": try one of ${queries().map((x) => x.name).join(", ")}`);
  return query(dir, readFileSync(q.path, "utf8"), c);
}

/** A plain-text table, for the terminal. */
export function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(no rows)";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const w = cols.map((k) => Math.min(60, Math.max(k.length, ...rows.map((r) => cell(r[k]).length))));
  const line = (vals: string[]) => vals.map((v, i) => (v.length > w[i]! ? `${v.slice(0, w[i]! - 1)}…` : v.padEnd(w[i]!))).join("  ").trimEnd();
  return [line(cols), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(cols.map((k) => cell(r[k]))))].join("\n");
}
