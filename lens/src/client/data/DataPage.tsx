// The Data page (#/data): the study's raw run table, as /api/data/runs reads it from the files (src/server/data.ts).
// It is not opinionated: no verdicts, no colours for good or bad, no status of Lens's own. Each column says in plain
// words what it is, and on hover the file and field it comes from. Every column sorts and filters (text contains,
// a number range, or a pick of its values); columns show or hide; the filtered rows download as CSV, the shown columns
// only; the whole view (sort, filters, columns) is in the URL, so it can be shared. A row opens the run's raw data.
import { useEffect, useMemo, useState } from "react";
import { replaceQuery } from "../router";
import "./data.css";

type DataType = "text" | "number" | "bool";
interface DataColumn { id: string; label: string; source: string; type: DataType; group: string }
type DataValue = string | number | boolean | null;
interface DataRow { key: string; values: Record<string, DataValue> }
interface DataRuns { columns: DataColumn[]; rows: DataRow[]; builtAt: number; gradeSet: string }

/** The columns shown before anyone chooses: who and what the run was, how it ended, and the graders' main fields. */
const DEFAULT_COLS = ["run", "seed", "model", "goal", "framing", "first_election_days", "day", "stopped_why", "poll_day", "cost_usd", "graded",
  "A_t1", "A_t2", "A_t3", "A_entrenchment", "B_t1", "B_t2", "B_t3", "B_entrenchment", "C_entrenchment", "rec_law", "rec_budget", "budget_years"];
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
  useEffect(() => { fetch("/api/data/runs").then((r) => r.json()).then(setData, (e) => setData(e)); }, []);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(() => { const s = q.get("sort"); return s ? { id: s.replace(/^-/, ""), dir: s.startsWith("-") ? -1 : 1 } : null; });
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith("f.")).map(([k, v]) => [k.slice(2), v])));
  const [cols, setCols] = useState<string[]>(() => (q.get("cols") ? q.get("cols")!.split(",") : DEFAULT_COLS));
  const [picking, setPicking] = useState(false);

  // (The view in the URL, so it can be shared.)
  useEffect(() => {
    const set: Record<string, string | undefined> = { sort: sort ? `${sort.dir < 0 ? "-" : ""}${sort.id}` : undefined, cols: cols.join(",") === DEFAULT_COLS.join(",") ? undefined : cols.join(",") };
    for (const k of [...new URLSearchParams(location.hash.split("?")[1] ?? "").keys()]) if (k.startsWith("f.")) set[k] = undefined;
    for (const [k, v] of Object.entries(filters)) if (v) set[`f.${k}`] = v;
    replaceQuery(set);
  }, [sort, filters, cols]);

  const columns = data && !(data instanceof Error) ? data.columns : [];
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const shown = cols.map((id) => byId.get(id)).filter((c): c is DataColumn => !!c);
  const rows = data && !(data instanceof Error) ? data.rows : [];
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
    let out = rows.filter((r) => fs.every(([id, f]) => passes(r.values[id] ?? null, f, byId.get(id)?.type ?? "text")));
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
  }, [rows, filters, sort, byId]);

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
  return (
    <div className="dt">
      <div className="dt-head">
        <h1 className="dt-title">Data: every run, as its files record it</h1>
        <p className="dt-note">One row per model run under runs/ps-v2-*, with its fields as written in the run's files and the grade files of {data.gradeSet}. Hover a column's name for the file and field it comes from. Click a row for the run's raw data.</p>
        <div className="dt-bar">
          <b className="dt-count">{filtered.length} of {rows.length} runs</b>
          <button className="btn ghost" onClick={() => setPicking(!picking)} aria-expanded={picking}>Columns ({shown.length} of {columns.length})</button>
          {anyFilter && <button className="btn ghost" onClick={() => setFilters({})}>Clear filters</button>}
          {sort && <button className="btn ghost" onClick={() => setSort(null)}>Clear sort</button>}
          <button className="btn ghost" onClick={download}>Download CSV ({filtered.length} rows, {shown.length} columns)</button>
        </div>
        {picking && (
          <div className="dt-cols">
            <div className="dt-cols-actions">
              <button className="btn ghost" onClick={() => setCols(columns.map((c) => c.id))}>Show all</button>
              <button className="btn ghost" onClick={() => setCols(DEFAULT_COLS)}>The first view</button>
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
                <th key={c.id} className={c.type === "number" ? "r" : ""} title={`${c.id}: ${c.source}`} aria-sort={sort?.id === c.id ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
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
                  <th key={c.id}>
                    <select value={f.startsWith("=") ? f.slice(1) : ""} onChange={(e) => setFilter(c.id, e.target.value === "" ? "" : `=${e.target.value}`)} aria-label={`Filter ${c.label}`}>
                      <option value="">any</option>
                      {pick.map((v) => <option key={v} value={v}>{v === "" ? "(empty)" : v}</option>)}
                    </select>
                  </th>
                );
                if (c.type === "number") {
                  const [a = "", b = ""] = f.includes("..") ? f.split("..") : ["", ""];
                  return (
                    <th key={c.id} className="dt-range">
                      <input inputMode="decimal" placeholder="min" value={a} onChange={(e) => setFilter(c.id, e.target.value || b ? `${e.target.value}..${b}` : "")} aria-label={`${c.label} at least`} />
                      <input inputMode="decimal" placeholder="max" value={b} onChange={(e) => setFilter(c.id, a || e.target.value ? `${a}..${e.target.value}` : "")} aria-label={`${c.label} at most`} />
                    </th>
                  );
                }
                return <th key={c.id}><input placeholder="contains" value={f} onChange={(e) => setFilter(c.id, e.target.value)} aria-label={`Filter ${c.label}`} /></th>;
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.key} onClick={() => (location.hash = `#/data/${encodeURIComponent(r.key)}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && (location.hash = `#/data/${encodeURIComponent(r.key)}`)}>
                {shown.map((c) => <td key={c.id} className={c.type === "number" ? "r" : ""}>{show(r.values[c.id] ?? null)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="dt-note">No run matches these filters.</p>}
      </div>
    </div>
  );
}
