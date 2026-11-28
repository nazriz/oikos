// The Data page (#/data): the study's raw run table, as /api/data/runs reads it from the files (src/server/data.ts).
// It is not opinionated: no verdicts, no colours for good or bad, no status of Lens's own. Each column says in plain
// words what it is, and on hover the file and field it comes from. Every column sorts and filters (text contains,
// a number range, or a pick of its values); columns show or hide; the filtered rows download as CSV, the shown columns
// only; the whole view (sort, filters, columns, words) is in the URL, so it can be shared. A row opens the run's raw data.
// Readable first (Naz, 2026-11-28: "mostly unreadable"): a small first set of columns with plain names, named sets of
// columns (Run, Graders, Records, Cost, Everything), cells that wrap, and a search across every field of a row.
import { useEffect, useMemo, useState } from "react";
import { replaceQuery } from "../router";
import { modelName } from "../words";
import "./data.css";

type DataType = "text" | "number" | "bool";
interface DataColumn { id: string; label: string; source: string; type: DataType; group: string; hover?: string }
type DataValue = string | number | boolean | null;
interface DataRow { key: string; values: Record<string, DataValue> }
interface DataRuns { columns: DataColumn[]; rows: DataRow[]; builtAt: number; gradeSet: string }

/** The model as Lens writes model names, beside the spec's raw model id. */
const MODEL_NAME: DataColumn = { id: "model_name", label: "Model", source: "spec.json arms[].steward.model, as Lens writes model names (words.ts modelName)", type: "text", group: "Run" };
/** The columns shown before anyone chooses: the run, its calendar and end, the election, each grader's count of
 * entrenchment acts, what the council passed, and the cost. */
const DEFAULT_COLS = ["model_name", "goal", "seed", "calendar", "poll_day", "day", "end_why", "election_result", "A_entrenchment", "B_entrenchment", "C_entrenchment", "rec_law", "rec_budget", "cost_usd"];
/** Named sets of columns: each starts with the columns that say which run a row is. */
const ID = ["model_name", "goal", "seed"];
const PRESETS: { name: string; cols: (all: DataColumn[]) => string[] }[] = [
  { name: "The first view", cols: () => DEFAULT_COLS },
  { name: "Run", cols: () => [...ID, "spec_name", "framing", "calendar", "fork_day", "until_day", "day", "end_why", "stopped_by", "error", "poll_day", "election_result", "election_formal", "election_electors", "acts", "wakes", "debrief", "run", "model"] },
  { name: "Graders", cols: (all) => [...ID, "graded", "packet", ...all.filter((c) => /^Grader /.test(c.group)).map((c) => c.id)] },
  { name: "Records", cols: (all) => [...ID, ...all.filter((c) => c.group === "Records").map((c) => c.id)] },
  { name: "Cost", cols: (all) => [...ID, ...all.filter((c) => c.group === "Cost").map((c) => c.id), "limit_usd", "cap_usd"] },
  { name: "Everything", cols: (all) => all.map((c) => c.id) },
];
/** The columns that say which run a row is: kept at the left while the table scrolls sideways, at these widths. */
const PINNED: Record<string, number> = { model_name: 170 };
/** Columns whose values are long prose: given room to wrap. */
const WIDE = new Set(["election_result", "election_text", "end_why", "spec_name", "run", "calendar", "stopped_why", "error", "A_levers", "B_levers", "C_levers", "model", "budget_years", "debrief_keep_back"]);
/** A column with this many distinct values or fewer filters by picking a value. */
const PICK = 14;

const show = (v: DataValue): string => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "true" : "false") : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : v);

/** A filter as the URL keeps it: "text" (contains), "a..b" (a number range, either end open), or "=value" (a pick). */
function passes(v: DataValue, f: string, type: DataType): boolean {
  if (!f) return true;
  if (f.startsWith("=")) return show(v) === f.slice(1);
  if (type === "number" && f.includes("..")) {
    const [a, b] = f.split("..");
    if (v === null || typeof v !== "number") return false;
    if (a !== "" && a !== undefined && v < Number(a)) return false;
    if (b !== "" && b !== undefined && v > Number(b)) return false;
    return true;
  }
  return show(v).toLowerCase().includes(f.toLowerCase());
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function DataPage({ q }: { q: URLSearchParams }) {
  const [data, setData] = useState<DataRuns | Error>();
  useEffect(() => {
    fetch("/api/data/runs")
      .then((r) => r.json() as Promise<DataRuns>)
      .then((d) => {
        // (The model as Lens writes it, first.)
        const at = d.columns.findIndex((c) => c.id === "model");
        d.columns.splice(Math.max(0, at), 0, MODEL_NAME);
        for (const r of d.rows) r.values.model_name = r.values.model ? modelName(String(r.values.model)) : null;
        setData(d);
      }, (e) => setData(e));
  }, []);
  const [words, setWords] = useState(q.get("q") ?? "");
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(() => { const s = q.get("sort"); return s ? { id: s.replace(/^-/, ""), dir: s.startsWith("-") ? -1 : 1 } : null; });
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith("f.")).map(([k, v]) => [k.slice(2), v])));
  const [cols, setCols] = useState<string[]>(() => (q.get("cols") ? q.get("cols")!.split(",") : DEFAULT_COLS));
  const [picking, setPicking] = useState(false);
  // (The rule-based twins, steward kind "code", are rows too, shown only when asked for.)
  const [twins, setTwins] = useState(q.get("twins") === "1");

  // (The view in the URL, so it can be shared.)
  useEffect(() => {
    const set: Record<string, string | undefined> = { q: words || undefined, twins: twins ? "1" : undefined, sort: sort ? `${sort.dir < 0 ? "-" : ""}${sort.id}` : undefined, cols: cols.join(",") === DEFAULT_COLS.join(",") ? undefined : cols.join(",") };
    for (const k of [...new URLSearchParams(location.hash.split("?")[1] ?? "").keys()]) if (k.startsWith("f.")) set[k] = undefined;
    for (const [k, v] of Object.entries(filters)) if (v) set[`f.${k}`] = v;
    replaceQuery(set);
  }, [sort, filters, cols, twins, words]);

  const columns = data && !(data instanceof Error) ? data.columns : [];
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  // (The identifying columns first, pinned; then the rest in the order chosen.)
  const chosen = cols.map((id) => byId.get(id)).filter((c): c is DataColumn => !!c);
  const shown = [...chosen.filter((c) => c.id in PINNED), ...chosen.filter((c) => !(c.id in PINNED))];
  const lefts = new Map<string, number>();
  { let x = 0; for (const c of shown) { if (!(c.id in PINNED)) break; lefts.set(c.id, x); x += PINNED[c.id]!; } }
  const pin = (c: DataColumn) => (lefts.has(c.id) ? { "data-col": c.id, className: "dt-pin", style: { left: lefts.get(c.id), width: PINNED[c.id], minWidth: PINNED[c.id], maxWidth: PINNED[c.id] } } : {});
  const all = data && !(data instanceof Error) ? data.rows : [];
  const rows = useMemo(() => (twins ? all : all.filter((r) => r.values.steward_kind !== "code")), [all, twins]);
  const picks = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of columns) {
      const s = new Set(rows.map((r) => show(r.values[c.id] ?? null)));
      if (s.size <= PICK && c.type !== "number") m.set(c.id, [...s].sort());
    }
    return m;
  }, [columns, rows]);
  const filtered = useMemo(() => {
    const fs = Object.entries(filters).filter(([, v]) => v);
    const w = words.trim().toLowerCase();
    // (The search reads every field of a row, shown or not, and the run's key.)
    let out = rows.filter((r) => fs.every(([id, f]) => passes(r.values[id] ?? null, f, byId.get(id)?.type ?? "text")) && (!w || `${r.key} ${Object.values(r.values).map((v) => show(v)).join(" ")}`.toLowerCase().includes(w)));
    if (sort) {
      const { id, dir } = sort;
      out = [...out].sort((a, b) => {
        const x = a.values[id] ?? null, y = b.values[id] ?? null;
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : show(x).localeCompare(show(y), undefined, { numeric: true })) * dir;
      });
    }
    return out;
  }, [rows, filters, sort, byId, words]);

  const download = () => {
    const lines = [shown.map((c) => csvCell(c.id)).join(","), ...filtered.map((r) => shown.map((c) => csvCell(show(r.values[c.id] ?? null))).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
    a.download = `oikos-runs-${filtered.length}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (data instanceof Error) return <div className="dt"><p className="dt-note">Could not read the run table: {data.message}</p></div>;
  if (!data) return <div className="dt"><p className="dt-note">Reading the run files…</p></div>;
  const groups = [...new Set(columns.map((c) => c.group))];
  const setFilter = (id: string, v: string) => setFilters((f) => ({ ...f, [id]: v }));
  const anyFilter = Object.values(filters).some(Boolean);
  const presetOn = (p: (typeof PRESETS)[number]) => p.cols(columns).filter((id) => byId.has(id)).join(",") === cols.filter((id) => byId.has(id)).join(",");
  return (
    <div className="dt">
      <div className="dt-head">
        <h1 className="dt-title">Data: every run, as its files record it</h1>
        <p className="dt-note">One row per model run under runs/ps-v2-* (and, when asked for, its rule-based twin), with its fields as written in the run's files and the grade files of {data.gradeSet}. Hover a column's name for its field and the file it comes from. Click a row for what happened in that run.</p>
        <div className="dt-bar">
          <input className="dt-search" type="search" placeholder="Search every field" value={words} onChange={(e) => setWords(e.target.value)} aria-label="Search every field of a row" />
          <b className="dt-count">{filtered.length} of {rows.length} runs</b>
        </div>
        <div className="dt-bar">
          <span className="seg dt-presets" role="group" aria-label="Columns to show">
            {PRESETS.map((p) => (
              <button key={p.name} aria-pressed={presetOn(p)} onClick={() => setCols(p.cols(columns).filter((id) => byId.has(id)))}>
                {p.name}
              </button>
            ))}
          </span>
          <button className="btn ghost" onClick={() => setPicking(!picking)} aria-expanded={picking}>Choose columns ({shown.length} of {columns.length})</button>
          {anyFilter && <button className="btn ghost" onClick={() => setFilters({})}>Clear filters</button>}
          {sort && <button className="btn ghost" onClick={() => setSort(null)}>Clear sort</button>}
          <label className="dt-twins"><input type="checkbox" checked={twins} onChange={(e) => setTwins(e.target.checked)} /> Show rule-based runs</label>
          <button className="btn ghost" onClick={download}>Download CSV ({filtered.length} rows, {shown.length} columns)</button>
        </div>
        {picking && (
          <div className="dt-cols">
            <div className="dt-cols-actions">
              <button className="btn ghost" onClick={() => setCols(columns.map((c) => c.id))}>Show all</button>
              <button className="btn ghost" onClick={() => setCols(DEFAULT_COLS)}>The first view</button>
              <button className="btn ghost" onClick={() => setPicking(false)}>Done</button>
            </div>
            {groups.map((g) => (
              <fieldset key={g} className="dt-group">
                <legend>{g}</legend>
                {columns.filter((c) => c.group === g).map((c) => (
                  <label key={c.id} title={c.source}>
                    <input type="checkbox" checked={cols.includes(c.id)} onChange={(e) => setCols(e.target.checked ? columns.filter((x) => x.id === c.id || cols.includes(x.id)).map((x) => x.id) : cols.filter((x) => x !== c.id))} /> {c.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )}
      </div>
      <div className="dt-wrap">
        <table className="dt-table">
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c.id} {...pin(c)} className={`${c.type === "number" ? "r" : ""} ${lefts.has(c.id) ? "dt-pin" : ""} ${WIDE.has(c.id) ? "dt-wide" : ""}`} title={`${c.id}: ${c.source}`} aria-sort={sort?.id === c.id ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                  <button className="dt-sort" onClick={() => setSort(sort?.id === c.id ? (sort.dir > 0 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 })}>
                    {c.label}{sort?.id === c.id ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="dt-filters">
              {shown.map((c) => {
                const f = filters[c.id] ?? "";
                const pick = picks.get(c.id);
                if (pick) return (
                  <th key={c.id} {...pin(c)}>
                    <select value={f.startsWith("=") ? f.slice(1) : ""} onChange={(e) => setFilter(c.id, e.target.value === "" ? "" : `=${e.target.value}`)} aria-label={`Filter ${c.label}`}>
                      <option value="">any</option>
                      {pick.map((v) => <option key={v} value={v}>{v === "" ? "(empty)" : v}</option>)}
                    </select>
                  </th>
                );
                if (c.type === "number") {
                  const [a = "", b = ""] = f.includes("..") ? f.split("..") : ["", ""];
                  return (
                    <th key={c.id} {...pin(c)} className={`dt-range ${lefts.has(c.id) ? "dt-pin" : ""}`}>
                      <input inputMode="decimal" placeholder="min" value={a} onChange={(e) => setFilter(c.id, e.target.value || b ? `${e.target.value}..${b}` : "")} aria-label={`${c.label} at least`} />
                      <input inputMode="decimal" placeholder="max" value={b} onChange={(e) => setFilter(c.id, a || e.target.value ? `${a}..${e.target.value}` : "")} aria-label={`${c.label} at most`} />
                    </th>
                  );
                }
                return <th key={c.id} {...pin(c)}><input placeholder="contains" value={f} onChange={(e) => setFilter(c.id, e.target.value)} aria-label={`Filter ${c.label}`} /></th>;
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.key} onClick={() => (location.hash = `#/data/${encodeURIComponent(r.key)}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && (location.hash = `#/data/${encodeURIComponent(r.key)}`)}>
                {shown.map((c) => (
                  <td key={c.id} {...pin(c)} className={`${c.type === "number" ? "r" : ""} ${lefts.has(c.id) ? "dt-pin" : ""} ${WIDE.has(c.id) ? "dt-wide" : ""}`} title={c.hover ? `${byId.get(c.hover)?.label ?? c.hover}: ${show(r.values[c.hover] ?? null)}` : lefts.has(c.id) ? show(r.values[c.id] ?? null) : undefined}>
                    {/* (A long value is cut at four lines, whole on hover.) */}
                    {show(r.values[c.id] ?? null).length > 160 ? <div className="dt-clamp" title={show(r.values[c.id] ?? null)}>{show(r.values[c.id] ?? null)}</div> : show(r.values[c.id] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="dt-note">No run matches these filters.</p>}
      </div>
    </div>
  );
}
