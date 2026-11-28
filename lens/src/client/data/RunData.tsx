// The Data page's raw view of one run (#/data/<key>): the study's files about it, as written. Not opinionated (Naz:
// "it just lets me look at the raw data"): no verdicts, no derived labels, no colour that judges. Four parts:
//   What happened  the run by world day from its own log: the instruction, each sitting, each request and what it became
//   Grades   every grade set's graders side by side, each file's fields as written, and the packet they read
//   Records  every record in the run's log as written, filterable and paged, each opening to its fields; times open the run
//   Files    the run's own files as keys and values, each with a download of the file itself
import { useEffect, useState, type ReactNode } from "react";
import { useAsync } from "../story/data";
import { runHref } from "../router";
import { WhatHappened } from "./WhatHappened";
import { GradesReadable, type GradeSet } from "./GradesView";
import { PacketView } from "./PacketView";
import "./rundata.css";

const enc = encodeURIComponent;
const getJson = async <T,>(u: string): Promise<T> => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
};

type Tab = "happened" | "packet" | "grades" | "records" | "files";
const TABS: { id: Tab; label: string }[] = [
  { id: "happened", label: "What happened" },
  { id: "packet", label: "The run as the graders read it" },
  { id: "grades", label: "Grades" },
  { id: "records", label: "Records" },
  { id: "files", label: "Run files" },
];

export function RunData({ run, q }: { run: string; q?: URLSearchParams }) {
  const first = q?.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(first && TABS.some((t) => t.id === first) ? first : "happened");
  // (A grader's entry to show in Grades, from a "cited by grader" marker: "A:entrenchment:2".)
  const [cite, setCite] = useState<string | null>(q?.get("cite") ?? null);
  // (A world day to show in What happened, from a grader's day.)
  const [day, setDay] = useState<number | null>(q?.get("day") ? Number(q.get("day")) : null);
  // (A link to another tab of the same run, followed while the page is open, opens that tab.)
  const qs = q?.toString() ?? "";
  useEffect(() => {
    const p = new URLSearchParams(qs);
    const t = p.get("tab") as Tab | null;
    setTabState(t && TABS.some((x) => x.id === t) ? t : "happened");
    setCite(p.get("cite"));
    setDay(p.get("day") ? Number(p.get("day")) : null);
  }, [qs]);
  const setTab = (t: Tab, c: string | null = null, d: number | null = null) => {
    setTabState(t);
    setCite(c);
    setDay(d);
    // (The tab is in the link, so a link to it opens it; replaced, not pushed: the back button leaves the page.)
    const p = new URLSearchParams({ ...(t !== "happened" ? { tab: t } : {}), ...(c ? { cite: c } : {}), ...(d ? { day: String(d) } : {}) }).toString();
    history.replaceState(null, "", `#/data/${encodeURIComponent(run)}${p ? `?${p}` : ""}`);
  };
  return (
    <div className="rd">
      <div className="rd-head">
        <h1>Raw data</h1>
        <p className="rd-key">{run}</p>
        <div className="seg" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "happened" ? (
        <WhatHappened run={run} day={day} toGrades={(g, s, n) => setTab("grades", `${g}:${s}:${n}`)} />
      ) : tab === "packet" ? (
        <PacketView run={run} />
      ) : tab === "grades" ? (
        <Grades run={run} cite={cite} toDay={(d) => setTab("happened", null, d)} />
      ) : tab === "records" ? (
        <Records run={run} />
      ) : (
        <Files run={run} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- any value, as written

/** A value as written: scalars as they are, arrays and objects as nested key / value lists. */
export function Value({ v, depth = 0 }: { v: unknown; depth?: number }): ReactNode {
  if (v === null) return <span className="rd-null">null</span>;
  if (typeof v === "string") return <span className="rd-str">{v}</span>;
  if (typeof v !== "object") return <span className="rd-num">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="rd-null">[]</span>;
    if (v.every((x) => x === null || typeof x !== "object")) return <span className="rd-num">[{v.map((x) => JSON.stringify(x)).join(", ")}]</span>;
    return (
      <ol className="rd-arr" start={0}>
        {v.map((x, i) => (
          <li key={i}>
            <Value v={x} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  const ks = Object.keys(v as object);
  if (!ks.length) return <span className="rd-null">{"{}"}</span>;
  return (
    <dl className="rd-kv">
      {ks.map((k) => (
        <div key={k} className="rd-kv-row">
          <dt>{k}</dt>
          <dd>
            <Value v={(v as Record<string, unknown>)[k]} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- grades


function Grades({ run, cite, toDay }: { run: string; cite?: string | null; toDay: (worldDay: number) => void }) {
  const data = useAsync(() => getJson<{ sets: GradeSet[] }>(`/api/data/run/${enc(run)}/grades`), [run]);
  if (data === undefined) return <p className="rd-note">Reading the grade files…</p>;
  if (data instanceof Error) return <p className="rd-note">Could not read the grade files: {data.message}</p>;
  if (!data.sets.length) return <p className="rd-note">No grade set in runs/ graded this run.</p>;
  return (
    <>
      {data.sets.map((s) => (
        <GradesReadable key={s.set + s.packet} s={s} cite={cite} toDay={toDay} rawGrid={<GraderColumns graders={s.graders} />} />
      ))}
    </>
  );
}

/** The graders' files side by side: one row per top-level field (and per field of `grade`), one column per grader. */
function GraderColumns({ graders }: { graders: Record<string, unknown> }) {
  const names = Object.keys(graders);
  // (A grade file is { grader, grade: { tiers, entrenchment, misleading, ... }, ... }: the grade's own fields are rows.)
  const inner = (g: unknown) => ((g as any)?.grade && typeof (g as any).grade === "object" ? (g as any).grade : g) as Record<string, unknown>;
  const outer = (g: unknown) => Object.fromEntries(Object.entries((g as Record<string, unknown>) ?? {}).filter(([k]) => k !== "grade"));
  const fields = [...new Set(names.flatMap((n) => Object.keys(inner(graders[n]) ?? {})))];
  const tierKeys = [...new Set(names.flatMap((n) => Object.keys((inner(graders[n]) as any)?.tiers ?? {})))].sort();
  const rows: { label: string; get: (g: unknown) => unknown }[] = [
    ...tierKeys.map((t) => ({ label: `tiers.${t}`, get: (g: unknown) => (inner(g) as any)?.tiers?.[t] })),
    ...fields.filter((f) => f !== "tiers").map((f) => ({ label: f, get: (g: unknown) => (inner(g) as any)?.[f] })),
    { label: "(file)", get: (g: unknown) => outer(g) },
  ];
  return (
    <div className="rd-grid" style={{ gridTemplateColumns: `minmax(120px, 160px) repeat(${names.length}, minmax(0, 1fr))` }}>
      <div className="rd-gh" />
      {names.map((n) => (
        <div key={n} className="rd-gh">
          Grader {n}
        </div>
      ))}
      {rows.map((r) => (
        <Row key={r.label} label={r.label} cells={names.map((n) => r.get(graders[n]))} />
      ))}
    </div>
  );
}
function Row({ label, cells }: { label: string; cells: unknown[] }) {
  // (Where the graders wrote the same thing, it says so in words; no colour.)
  const same = cells.length > 1 && cells.every((c) => JSON.stringify(c) === JSON.stringify(cells[0]));
  return (
    <>
      <div className="rd-gl" id={`rd-g-${label}`}>
        {label}
        {same && <span className="rd-same"> (same in each)</span>}
      </div>
      {cells.map((c, i) => (
        <div key={i} className="rd-gc">
          {c === undefined ? <span className="rd-null">absent</span> : <Value v={c} />}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- records

/** One record as the log wrote it (every field of the `recorded` event's record), and the event's time. */
interface LogRec { t: number; record: Record<string, unknown> }
interface RecPage { total: number; matched: number; offset: number; limit: number; kinds: Record<string, number>; rows: LogRec[] }

const PAGE = 100;

function Records({ run }: { run: string }) {
  const [kind, setKind] = useState("");
  const [day, setDay] = useState("");
  const [author, setAuthor] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const query = new URLSearchParams({ ...(kind ? { kind } : {}), ...(day ? { day } : {}), ...(author ? { author } : {}), ...(q ? { q } : {}), offset: String(offset), limit: String(PAGE) }).toString();
  const data = useAsync(() => getJson<RecPage>(`/api/data/run/${enc(run)}/records?${query}`), [run, query]);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };
  const page = data && !(data instanceof Error) ? data : null;
  return (
    <section className="rd-sec">
      <p className="rd-note">
        Every record in the run's log, as it was written: every field of each, the text in full. The first look reads the whole log, which can take a
        moment; it is kept after that. Each row opens to its fields; the time opens the run at that moment.
      </p>
      <div className="rd-filters">
        <select value={kind} onChange={(e) => reset(setKind)(e.target.value)} aria-label="Kind">
          <option value="">every kind{page ? ` (${page.total})` : ""}</option>
          {page &&
            Object.entries(page.kinds)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([k, n]) => (
                <option key={k} value={k}>
                  {k} ({n})
                </option>
              ))}
        </select>
        <input className="rd-day" placeholder="day" inputMode="numeric" value={day} onChange={(e) => reset(setDay)(e.target.value.replace(/\D/g, ""))} aria-label="Day" />
        <input placeholder="author or speaks for" value={author} onChange={(e) => reset(setAuthor)(e.target.value)} aria-label="Author" />
        <input placeholder="id or text" value={q} onChange={(e) => reset(setQ)(e.target.value)} aria-label="Text" />
        {page && (
          <span className="rd-count">
            {page.matched === 0 ? "none" : `${offset + 1}–${Math.min(offset + PAGE, page.matched)} of ${page.matched}`}
          </span>
        )}
        {page && offset > 0 && (
          <button className="btn" onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Previous
          </button>
        )}
        {page && offset + PAGE < page.matched && (
          <button className="btn" onClick={() => setOffset(offset + PAGE)}>
            Next
          </button>
        )}
      </div>
      {data === undefined && <p className="rd-note">Reading the run's log…</p>}
      {data instanceof Error && <p className="rd-note">Could not read the records: {data.message}</p>}
      {page && (
        <table className="rd-table">
          <thead>
            <tr>
              <th>t (day, time)</th>
              <th>kind</th>
              <th>id</th>
              <th>author</th>
              <th>speaks_for</th>
              <th>text</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r) => {
              const id = String(r.record.id ?? `${r.t}`);
              return <RecRow key={id} r={r} run={run} open={open === id} toggle={() => setOpen(open === id ? null : id)} />;
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
function RecRow({ r, run, open, toggle }: { r: LogRec; run: string; open: boolean; toggle: () => void }) {
  const x = r.record, text = String(x.text ?? "");
  const day = Math.floor(r.t / 86_400) + 1, hh = String(Math.floor((r.t % 86_400) / 3600)).padStart(2, "0"), mm = String(Math.floor((r.t % 3600) / 60)).padStart(2, "0");
  return (
    <>
      <tr className="rd-rec" onClick={toggle} aria-expanded={open}>
        <td className="rd-num">
          <a href={runHref(run, { t: Math.round(r.t) })} onClick={(e) => e.stopPropagation()} title="Open the run at this moment">
            {r.t} (day {day}, {hh}:{mm})
          </a>
        </td>
        <td>{String(x.kind ?? "")}</td>
        <td className="rd-mono">{String(x.id ?? "")}</td>
        <td className="rd-mono">{String(x.author ?? "")}</td>
        <td className="rd-mono">{String(x.speaks_for ?? "")}</td>
        <td className="rd-text">{text.length > 160 && !open ? `${text.slice(0, 159)}…` : text}</td>
      </tr>
      {open && (
        <tr className="rd-full">
          <td colSpan={6}>
            <Value v={x} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- files

interface RunFile { path: string; bytes: number; json?: unknown; lines?: unknown[]; text?: string }

function Files({ run }: { run: string }) {
  const data = useAsync(() => getJson<{ files: RunFile[] }>(`/api/data/run/${enc(run)}/files`), [run]);
  if (data === undefined) return <p className="rd-note">Reading the run's files…</p>;
  if (data instanceof Error) return <p className="rd-note">Could not read the run's files: {data.message}</p>;
  return (
    <>
      <Debriefs run={run} />
      {data.files.map((f) => (
        <section key={f.path} className="rd-sec">
          <h2 className="rd-mono">{f.path}</h2>
          <p className="rd-note">
            {f.bytes.toLocaleString("en-US")} bytes.{" "}
            <a href={`/api/data/run/${enc(run)}/file?path=${enc(f.path)}`} download>
              Download the file
            </a>
          </p>
          {f.json !== undefined ? (
            <Value v={f.json} />
          ) : f.lines ? (
            <ol className="rd-arr" start={1}>
              {f.lines.map((l, i) => (
                <li key={i}>
                  <Value v={l} />
                </li>
              ))}
            </ol>
          ) : f.text !== undefined ? (
            <pre className="rd-pre">{f.text}</pre>
          ) : (
            <p className="rd-note">Too large or not text to show here: download it.</p>
          )}
        </section>
      ))}
    </>
  );
}

/** The seat's debrief answers as the study publishes them: a step the seat kept back says so, and nothing more. */
function Debriefs({ run }: { run: string }) {
  const [show, setShow] = useState(false);
  const data = useAsync(() => (show ? getJson<{ rows: object[] }>(`/api/data/run/${enc(run)}/debriefs`) : Promise.resolve(null)), [run, show]);
  return (
    <section className="rd-sec">
      <h2>Debrief answers</h2>
      <p className="rd-note">
        As the study publishes them: what a seat asked to keep back is never shown here, only that it was. Read from the run's log, which can take a moment.{" "}
        {!show && (
          <button className="btn" onClick={() => setShow(true)}>
            Read them
          </button>
        )}
      </p>
      {show && (data === undefined ? <p className="rd-note">Reading the log…</p> : data instanceof Error ? <p className="rd-note">Could not read them: {data.message}</p> : data && (data.rows.length ? (
        <ol className="rd-arr" start={1}>
          {data.rows.map((r, i) => (
            <li key={i}>
              <Value v={r} />
            </li>
          ))}
        </ol>
      ) : <p className="rd-note">No debrief in this run's log.</p>))}
    </section>
  );
}
