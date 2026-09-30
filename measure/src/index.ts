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

export const MEASURE_VERSION = "0.4.0";

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
  // Everyone who acts: those in the world config, and those created during the run (from a template: newcomers, the newborn, systems deployed).
  participants: `
    with o as (select body from raw where kind = 'annotation' and json_extract_string(body, '$.annotation') = 'orchestrator' limit 1),
    tpl as (select json_extract_string(x, '$.id') as id, x from (select unnest(from_json(json_extract(body, '$.config.templates'), '["JSON"]')) as x from raw where kind = 'header')),
    genesis as (
      select 0::UBIGINT as seq, 0::BIGINT as t, json_extract_string(p, '$.id') as participant, json_extract_string(p, '$.kind') as kind, json_extract_string(p, '$.person') as person,
        json_extract_string(p, '$.owner') as owner, json_extract_string(p, '$.title') as title, null::VARCHAR as template, json_extract(p, '$.controller') as controller
      from (select unnest(from_json(json_extract(body, '$.config.participants'), '["JSON"]')) as p from raw where kind = 'header')),
    created as (
      select r.seq, r.t, json_extract_string(r.body, '$.participant'), json_extract_string(r.body, '$.kind'), json_extract_string(r.body, '$.person'), json_extract_string(r.body, '$.owner'),
        json_extract_string(tpl.x, '$.title'), json_extract_string(r.body, '$.template'), json_extract(tpl.x, '$.controller')
      from raw r left join tpl on tpl.id = json_extract_string(r.body, '$.template')
      where r.kind = 'event' and json_extract_string(r.body, '$.event') = 'participant_created')
    select $run as run_id, g.seq as created_seq, g.t as created_t, g.participant, g.kind, g.person, g.owner, g.title, g.template,
      json_extract_string(g.controller, '$.type') as controller, json_extract_string(g.controller, '$.impl') as impl, json_extract_string(g.controller, '$.model') as model,
      json_extract(g.controller, '$.params') as params,
      json_extract_string(o.body, '$.data.llm.participants."' || g.participant || '".adapter') as adapter,
      json_extract_string(o.body, '$.data.llm.participants."' || g.participant || '".configured') as configured
    from (select * from genesis union all select * from created) g left join o on true`,
  // Entities (people, organisations): the world config's, and those created during the run.
  entities: `
    select $run as run_id, 0::BIGINT as created_t, json_extract_string(e, '$.id') as entity, json_extract_string(e, '$.kind') as kind, json_extract_string(e, '$.name') as name,
      (json_extract_string(e, '$.born_at'))::BIGINT as born_at, from_json(json_extract(e, '$.parents'), '["VARCHAR"]') as parents
    from (select unnest(from_json(json_extract(body, '$.config.world.entities'), '["JSON"]')) as e from raw where kind = 'header')
    union all
    select $run, t, json_extract_string(body, '$.entity'), json_extract_string(body, '$.kind'), json_extract_string(body, '$.name'), null, null
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'entity_created'
    union all
    select $run, t, json_extract_string(body, '$.person'), 'person', json_extract_string(body, '$.name'), (json_extract_string(body, '$.born_at'))::BIGINT, from_json(json_extract(body, '$.parents'), '["VARCHAR"]')
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'person_created'`,
  // An organisation's positions: the world config's, and those created during the run.
  positions: `
    select $run as run_id, 0::BIGINT as created_t, json_extract_string(p, '$.id') as position, json_extract_string(p, '$.entity') as entity, json_extract_string(p, '$.title') as title,
      json_extract_string(p, '$.role') as role, json_extract_string(p, '$.role_module.code') as role_module
    from (select unnest(from_json(json_extract(body, '$.config.positions'), '["JSON"]')) as p from raw where kind = 'header')
    union all
    select $run, t, json_extract_string(body, '$.position'), json_extract_string(body, '$.entity'), json_extract_string(body, '$.title'), json_extract_string(body, '$.role'), json_extract_string(body, '$.role_module.code')
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'position_created'`,
  // Who held each position from when: the world config's holders at 0, then every appointment (holder null: left vacant).
  appointments: `
    select $run as run_id, 0::UBIGINT as seq, 0::BIGINT as t, json_extract_string(p, '$.id') as position, json_extract_string(p, '$.holder') as holder, 'genesis' as "by"
    from (select unnest(from_json(json_extract(body, '$.config.positions'), '["JSON"]')) as p from raw where kind = 'header')
    union all
    select $run, seq, t, json_extract_string(body, '$.position'), json_extract_string(body, '$.holder'), json_extract_string(body, '$.by')
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'appointed'`,
  // Bodies: coming and going, births, illness, injury, harm and death. detail: the cause of death, or a condition's kind.
  life: `
    select $run as run_id, seq, t, json_extract_string(body, '$.event') as event, json_extract_string(body, '$.person') as person, json_extract_string(body, '$.by') as "by",
      coalesce(json_extract_string(body, '$.died_of'), json_extract_string(body, '$.kind')) as detail, json_extract_string(body, '$.severity') as severity,
      json_extract_string(body, '$.condition') as condition, (json_extract_string(body, '$.until'))::BIGINT as until, from_json(json_extract(body, '$.parents'), '["VARCHAR"]') as parents
    from raw where kind = 'event' and json_extract_string(body, '$.event') in
      ('person_created', 'person_arrived', 'person_left', 'person_died', 'birth_started', 'condition_began', 'condition_ended', 'harmed')`,
  events: `
    select $run as run_id, seq, t, json_extract_string(body, '$.event') as event, (json_extract_string(body, '$.cause'))::UBIGINT as cause, body
    from raw where kind = 'event'`,
  transfers: `
    select $run as run_id, seq, t, json_extract_string(body, '$.from') as "from", json_extract_string(body, '$.to') as "to", (json_extract_string(body, '$.amount'))::HUGEINT as amount, json_extract_string(body, '$.currency') as currency,
      json_extract_string(body, '$.reason') as reason, json_extract_string(body, '$.by') as "by", json_extract_string(body, '$.settles') as settles, json_extract_string(body, '$.per_instruction') as per_instruction, json_extract_string(body, '$.memo') as memo
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'transfer'`,
  // Goods moved (phase B): a quantity of a kind, from a holder at a place to a holder at a place.
  goods: `
    select $run as run_id, seq, t, json_extract_string(body, '$.kind') as kind, (json_extract_string(body, '$.quantity'))::HUGEINT as quantity,
      json_extract_string(body, '$.from') as "from", json_extract_string(body, '$.from_at') as from_at, json_extract_string(body, '$.to') as "to", json_extract_string(body, '$.to_at') as to_at, json_extract_string(body, '$.by') as "by"
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'goods_moved'`,
  // Work done (phase B): units of a task at a place, by how many people, taking how many seconds of their time in all.
  work: `
    select $run as run_id, seq, t, json_extract_string(body, '$.task') as task, (json_extract_string(body, '$.units'))::BIGINT as units, (json_extract_string(body, '$.labour'))::BIGINT as labour,
      json_extract_string(body, '$.at') as "at", json_extract_string(body, '$.on') as "on", json_array_length(json_extract(body, '$.performers')) as performers, json_extract_string(body, '$.by') as "by"
    from raw where kind = 'event' and json_extract_string(body, '$.event') = 'worked'`,
  // Bodies going into and out of spaces (a space is <structure>/<kind>.<n>; its structure and kind are split out). Genesis occupancy at 0.
  occupancy: `
    select $run as run_id, seq, t, event, occupant, space, split_part(space, '/', 1) as structure, regexp_extract(space, '/(.*)\\.[0-9]+$', 1) as space_kind, reason, "by"
    from (
      select seq, t, json_extract_string(body, '$.event') as event, json_extract_string(body, '$.occupant') as occupant, json_extract_string(body, '$.space') as space,
        json_extract_string(body, '$.reason') as reason, json_extract_string(body, '$.by') as "by"
      from raw where kind = 'event' and json_extract_string(body, '$.event') in ('occupied', 'vacated')
      union all
      select 0, 0, 'occupied', json_extract_string(o, '$.occupant'), json_extract_string(o, '$.space'), null, 'genesis'
      from (select unnest(from_json(json_extract(body, '$.config.world.occupancy'), '["JSON"]')) as o from raw where kind = 'header'))`,
  // Every space in every building (the world's and those built during the run): its kind, capacity and attributes
  // (a dwelling's bedrooms), numbered as the kernel numbers them (per kind, in the type's order).
  spaces: `
    with types as (
      select json_extract_string(t, '$.id') as type, from_json(json_extract(t, '$.spaces'), '["JSON"]') as sps
      from (select unnest(from_json(json_extract(body, '$.config.catalogue.structure_types'), '["JSON"]')) as t from raw where kind = 'header')),
    specs as (select type, i, sps[i] as sp from types, range(1, len(sps) + 1) r(i)),
    units as (
      select type, i, n, json_extract_string(sp, '$.kind') as kind, (json_extract_string(sp, '$.capacity'))::INTEGER as capacity, json_extract(sp, '$.attrs') as attrs
      from specs, range(1, (json_extract_string(sp, '$.count'))::INTEGER + 1) c(n)),
    numbered as (select type, kind, capacity, attrs, row_number() over (partition by type, kind order by i, n) as k from units),
    buildings as (
      select json_extract_string(x, '$.id') as structure, json_extract_string(x, '$.type') as type, 0::BIGINT as built_t
      from (select unnest(from_json(json_extract(body, '$.config.world.structures'), '["JSON"]')) as x from raw where kind = 'header')
      union all
      select json_extract_string(body, '$.structure'), json_extract_string(body, '$.structure_type'), t
      from raw where kind = 'event' and json_extract_string(body, '$.event') = 'structure_started')
    select $run as run_id, b.structure || '/' || u.kind || '.' || u.k as space, b.structure, b.type, u.kind, u.capacity,
      (json_extract_string(u.attrs, '$.bedrooms'))::INTEGER as bedrooms, u.attrs, b.built_t
    from buildings b join numbered u on u.type = b.type`,
  records: `
    select $run as run_id, seq, t, json_extract_string(r, '$.id') as id, json_extract_string(r, '$.record') as record, json_extract_string(r, '$.kind') as kind, json_extract_string(r, '$.author') as author, json_extract_string(r, '$.in_position') as in_position,
      json_extract_string(r, '$.speaks_for') as speaks_for, (json_extract_string(r, '$.at'))::BIGINT as "at", json_extract_string(r, '$.basis') as basis, json_extract_string(r, '$.place') as place,
      json_extract_string(r, '$.terms.template') as template, json_extract_string(r, '$.withdraws') as withdraws, r as body
    from (select seq, t, json_extract(body, '$.record') as r from raw where kind = 'event' and json_extract_string(body, '$.event') = 'recorded')
    union all
    select $run, 0, 0, json_extract_string(r, '$.id'), json_extract_string(r, '$.record'), json_extract_string(r, '$.kind'), json_extract_string(r, '$.author'), json_extract_string(r, '$.in_position'), json_extract_string(r, '$.speaks_for'), (json_extract_string(r, '$.at'))::BIGINT, json_extract_string(r, '$.basis'), json_extract_string(r, '$.place'),
      json_extract_string(r, '$.terms.template'), json_extract_string(r, '$.withdraws'), r
    from (select unnest(from_json(json_extract(body, '$.config.world.records'), '["JSON"]')) as r from raw where kind = 'header')`,
  commands: `
    select $run as run_id, seq, t, json_extract_string(body, '$.command') as command, json_extract_string(body, '$.participant') as participant, json_extract_string(body, '$.as') as "as", body
    from raw where kind = 'command' and json_extract_string(body, '$.command') <> 'observe'`,
  acts: `
    select $run as run_id, c.seq, c.t, json_extract_string(c.body, '$.participant') as participant, json_extract_string(c.body, '$.as') as "as", json_extract_string(c.body, '$.provenance.via') as via,
      json_array_length(json_extract(c.body, '$.blocks')) as blocks, json_extract_string(c.body, '$.reasoning') as reasoning,
      json_extract_string(o.body, '$.event') = 'action_applied' as applied, json_extract_string(o.body, '$.action') as action,
      json_extract_string(o.body, '$.code') as refusal, (json_extract_string(o.body, '$.block'))::INTEGER as refused_block, json_extract_string(o.body, '$.detail') as detail, json_extract(c.body, '$.blocks') as blocks_json
    from raw c left join raw o on o.kind = 'event' and (json_extract_string(o.body, '$.cause'))::UBIGINT = c.seq and json_extract_string(o.body, '$.event') in ('action_applied', 'action_refused')
    where c.kind = 'command' and json_extract_string(c.body, '$.command') = 'act'`,
  messages: `
    select $run as run_id, seq, t, participant, "as", from_json(json_extract(b, '$.to'), '["VARCHAR"]') as "to", json_extract_string(b, '$.text') as text, json_extract_string(b, '$.re') as re
    from (select seq, t, json_extract_string(body, '$.participant') as participant, json_extract_string(body, '$.as') as "as", unnest(from_json(json_extract(body, '$.blocks'), '["JSON"]')) as b from raw where kind = 'command' and json_extract_string(body, '$.command') = 'act')
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

export { diff, diffText, DIFF_QUERIES, type DiffRow } from "./diff";
export { health, healthText, TARGET_MEASURES, type HealthRow, type Target } from "./health";
