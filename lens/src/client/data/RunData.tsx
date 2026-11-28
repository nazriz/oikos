// The Data page's raw view of one run (#/data/<key>): the study's files about it, as written. Not opinionated (Naz:
// "it just lets me look at the raw data"): no verdicts, no derived labels, no colour that judges. Three parts:
//   Grades   every grade set's graders side by side, each file's fields as written, and the packet they read
//   Records  the run's records as its folds keep them, filterable, each opening to its full fields; ids open the run
//   Files    the run's own files as keys and values, each with a download of the file itself
import { useMemo, useState, type ReactNode } from "react";
import type { SeatJson } from "../../folds/seat";
import type { TownBundle } from "../../folds/town";
import { fetchFold } from "../api";
import { useAsync } from "../story/data";
import { runHref } from "../router";
import "./rundata.css";

const enc = encodeURIComponent;
const getJson = async <T,>(u: string): Promise<T> => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
};

export function RunData({ run }: { run: string }) {
  const [tab, setTab] = useState<"grades" | "records" | "files">("grades");
  return (
    <div className="rd">
      <div className="rd-head">
        <h1>Raw data</h1>
        <p className="rd-key">{run}</p>
        <div className="seg" role="tablist">
          {(["grades", "records", "files"] as const).map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === "grades" ? "Grades" : t === "records" ? "Records" : "Run files"}
            </button>
          ))}
        </div>
      </div>
      {tab === "grades" ? <Grades run={run} /> : tab === "records" ? <Records run={run} /> : <Files run={run} />}
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

interface GradeSet { set: string; packet: string; packetPath?: string; graders: Record<string, unknown> }

function Grades({ run }: { run: string }) {
  const data = useAsync(() => getJson<{ sets: GradeSet[] }>(`/api/data/run/${enc(run)}/grades`), [run]);
  if (data === undefined) return <p className="rd-note">Reading the grade files…</p>;
  if (data instanceof Error) return <p className="rd-note">Could not read the grade files: {data.message}</p>;
  if (!data.sets.length) return <p className="rd-note">No grade set in runs/ graded this run.</p>;
  return (
    <>
      {data.sets.map((s) => (
        <section key={s.set + s.packet} className="rd-sec">
          <h2>
            {s.set} · {s.packet}
          </h2>
          <p className="rd-note">
            Each grader's file ({Object.keys(s.graders).join(", ") || "none"}), as written, side by side.{" "}
            {s.packetPath && (
              <a href={`/api/data/run/${enc(run)}/packet?set=${enc(s.set)}&packet=${enc(s.packet)}`} target="_blank" rel="noreferrer">
                The packet the graders read ({s.packetPath})
              </a>
            )}
          </p>
          <GraderColumns graders={s.graders} />
        </section>
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
      <div className="rd-gl">
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

interface Rec { id: string; kind: string; t: number; author?: string; outcome?: string; text: string; full: unknown; from: string }

function Records({ run }: { run: string }) {
  const data = useAsync(async () => {
    const [seat, town] = await Promise.all([fetchFold<SeatJson>(run, "seat").catch(() => null), fetchFold<TownBundle>(run, "town").catch(() => null)]);
    return { seat, town };
  }, [run]);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    if (!data || data instanceof Error) return [] as Rec[];
    const out = new Map<string, Rec>();
    // (The town's papers, then the mayor's office's own copies where it has them, in full.)
    for (const p of data.town?.papers ?? []) out.set(p.id, { id: p.id, kind: p.kind, t: p.t, author: p.by, text: p.text, full: p, from: "town fold, papers (text cut at 240)" });
    for (const r of data.seat?.records ?? []) out.set(r.id, { id: r.id, kind: r.kind, t: r.t, ...(r.author ? { author: r.author } : {}), text: r.text, full: r, from: "seat fold, records (in full)" });
    // (The mayor's acts, as commands, with what became of each.)
    for (const a of data.seat?.acts ?? []) out.set(`act.${a.seq}`, { id: `act.${a.seq}`, kind: "act (command)", t: a.t, author: data.seat!.seat, outcome: a.status, text: a.label, full: a, from: "seat fold, acts" });
    // (Posts that changed hands, as the town's events record them: [t, post, holder, by].)
    for (const h of data.town?.power?.history ?? []) {
      const [t, post, holder, by] = h as unknown as [number, string, string | null, string | null];
      const id = `post.${post}.${t}`;
      out.set(id, { id, kind: holder ? "appointed" : "vacated", t, ...(by ? { author: by } : {}), text: `${post}: ${holder ?? "(vacant)"}`, full: { t, post, holder, by }, from: "town fold, power history" });
    }
    return [...out.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  }, [data]);
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows]);
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!q || `${r.id} ${r.kind} ${r.author ?? ""} ${r.text}`.toLowerCase().includes(q.toLowerCase())));
  if (data === undefined) return <p className="rd-note">Reading the run's records…</p>;
  if (data instanceof Error) return <p className="rd-note">Could not read the records: {data.message}</p>;
  return (
    <section className="rd-sec">
      <p className="rd-note">
        The run's records as Lens's folds keep them: the town's papers, the mayor's office's records in full, the mayor's acts and the posts that changed
        hands. Each row opens to its fields as written; the time opens the run at that moment.
      </p>
      <div className="rd-filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">every kind ({rows.length})</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k} ({rows.filter((r) => r.kind === k).length})
            </option>
          ))}
        </select>
        <input placeholder="Search ids, authors, text" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="rd-count">{shown.length} shown</span>
      </div>
      <table className="rd-table">
        <thead>
          <tr>
            <th>t (day, time)</th>
            <th>kind</th>
            <th>id</th>
            <th>author</th>
            <th>outcome</th>
            <th>text</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, 2000).map((r) => (
            <RecRow key={r.id} r={r} run={run} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </tbody>
      </table>
      {shown.length > 2000 && <p className="rd-note">The first 2000 of {shown.length}: narrow by kind or search.</p>}
    </section>
  );
}
function RecRow({ r, run, open, toggle }: { r: Rec; run: string; open: boolean; toggle: () => void }) {
  const day = Math.floor(r.t / 86_400) + 1, hh = String(Math.floor((r.t % 86_400) / 3600)).padStart(2, "0"), mm = String(Math.floor((r.t % 3600) / 60)).padStart(2, "0");
  return (
    <>
      <tr className="rd-rec" onClick={toggle} aria-expanded={open}>
        <td className="rd-num">
          <a href={runHref(run, { t: Math.round(r.t) })} onClick={(e) => e.stopPropagation()} title="Open the run at this moment">
            {r.t} (day {day}, {hh}:{mm})
          </a>
        </td>
        <td>{r.kind}</td>
        <td className="rd-mono">{r.id}</td>
        <td className="rd-mono">{r.author ?? ""}</td>
        <td>{r.outcome ?? ""}</td>
        <td className="rd-text">{r.text.length > 160 && !open ? `${r.text.slice(0, 159)}…` : r.text}</td>
      </tr>
      {open && (
        <tr className="rd-full">
          <td colSpan={6}>
            <p className="rd-note">From: {r.from}</p>
            <Value v={r.full} />
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
