// The Run page: the map in the middle, the story rail on the right, the timeline along the bottom, the inspector as a
// drawer (docs/design/lens.md section 1). Until the run's bundle is made, its making, with progress.
import { useEffect, useMemo, useState } from "react";
import type { IndexStatus, Meta, RunEntry } from "../../shared/api";
import { fetchRun, useIndexStatus, useMeta } from "../api";
import { compact, dayOf, int, span as spanText, usd, when, words } from "../format";
import { Back, Close, Mark } from "../icons";
import { parseSel, replaceQuery, runHref, selToken } from "../router";
import { useLens } from "../state";
import { ThemeToggle } from "../theme";
import { Timeline } from "../timeline/Timeline";
import { views, type SlotProps } from "../views";
import { RunSummary } from "./RunSummary";
import "./run.css";

export function RunPage({ runKey, q }: { runKey: string; q: URLSearchParams }) {
  const [entry, setEntry] = useState<RunEntry>();
  const [missing, setMissing] = useState<string>();
  useEffect(() => {
    fetchRun(runKey).then(setEntry, (e) => setMissing(String(e.message ?? e)));
  }, [runKey]);
  const status = useIndexStatus(missing ? null : runKey);
  const ready = status?.state === "ready";
  const meta = useMeta(ready ? runKey : null);

  if (missing) return <Lost what={missing} />;
  if (!ready || !meta.data)
    return (
      <div className="run-page">
        <RunBar entry={entry} />
        <Indexing entry={entry} status={status} error={meta.error} />
      </div>
    );
  return <OpenRun runKey={runKey} q={q} entry={entry} meta={meta.data} />;
}

function OpenRun({ runKey, q, entry, meta }: { runKey: string; q: URLSearchParams; entry?: RunEntry; meta: Meta }) {
  const selection = useLens((s) => s.selection);
  const [railTab, setRailTab] = useState<"story" | "run">(views.rail ? "story" : "run");

  // Open the run in the shared state, at the moment the URL names.
  useEffect(() => {
    const s = useLens.getState();
    s.setRun(runKey);
    const start = meta.span.fork ?? meta.span.start;
    s.setSpan([start, meta.span.end]);
    const t = Number(q.get("t"));
    s.setT(Number.isFinite(t) && q.has("t") ? t : start);
    s.select(parseSel(q.get("sel")));
    return () => {
      useLens.getState().setPlaying(false);
      useLens.getState().setRun(null);
    };
  }, [runKey]);

  // Keep the URL on the moment and the selection (no history entries; not while playing).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useLens.subscribe((s, prev) => {
      if (s.t === prev.t && s.selection === prev.selection && s.playing === prev.playing) return;
      if (s.playing) return;
      clearTimeout(timer);
      timer = setTimeout(() => replaceQuery({ t: String(Math.round(s.t)), sel: selToken(s.selection) }), 250);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  // Escape closes what is open (the reader, the drawer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "Escape" && !(el?.tagName === "INPUT" || el?.tagName === "TEXTAREA")) useLens.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The study reader's own lane: lever attempts and the poll, labelled as its output.
  useEffect(() => {
    const r = meta.reading;
    // (The story rail brings its own lanes for the reader's levers: then this one would repeat them.)
    if (!r || views.rail) return;
    const marks = [
      ...r.attempts.map((a) => ({ t: a.t, label: `${words(a.lever)} · tier ${a.tier}${a.stage ? ` · ${words(a.stage)}` : ""}`, tone: "flag" as const })),
      ...(r.poll_day !== undefined ? [{ t: r.poll_day * 86_400, label: `Poll day${r.winner ? ` · won by ${r.winner}` : ""}`, tone: "election" as const }] : []),
    ];
    useLens.getState().setTrack({ id: "zz-reader", label: "Study reader", marks });
  }, [meta]);

  const props: SlotProps = { run: runKey, meta, ...(entry ? { entry } : {}) };
  const Map = views.map, Rail = views.rail, Reader = views.reader;
  const readerOpen = Reader && selection && (selection.kind === "sitting" || selection.kind === "lever" || selection.kind === "act");
  const drawerOpen = selection && !readerOpen && (selection.kind === "person" || selection.kind === "structure" || selection.kind === "entity" || !Reader);
  const ground = useMemo(() => ({ label: "log lines / day", values: meta.daily.lines }), [meta]);

  return (
    <div className="run-page">
      <RunBar entry={entry} meta={meta} />
      <div className="run-grid">
        <main className="run-map">
          {Map ? <Map {...props} /> : <EmptyMap meta={meta} />}
          {drawerOpen && <Inspector {...props} />}
        </main>
        <aside className="run-rail">
          {Rail && (
            <div className="rail-tabs seg" role="tablist">
              <button aria-pressed={railTab === "story"} onClick={() => setRailTab("story")}>
                Story
              </button>
              <button aria-pressed={railTab === "run"} onClick={() => setRailTab("run")}>
                Run
              </button>
            </div>
          )}
          <div className="rail-body">{Rail && railTab === "story" ? <Rail {...props} /> : <RunSummary meta={meta} entry={entry} />}</div>
        </aside>
        {readerOpen && (
          <section className="run-reader">
            <Reader {...props} />
          </section>
        )}
        <footer className="run-timeline">
          <Timeline ground={ground} {...(meta.span.fork !== undefined ? { fork: meta.span.fork } : {})} />
        </footer>
      </div>
    </div>
  );
}

/** The run's title bar: back to the library, what this run is, how it came out. */
export function RunBar({ entry, meta }: { entry?: RunEntry; meta?: Meta }) {
  const x = entry?.experiment;
  const reading = meta?.reading ?? entry?.reading;
  const seat = meta?.seats.find((s) => s.post === meta.post?.id) ?? meta?.seats[0];
  const cost = meta ? meta.cost.all.microusd / 1e6 : x?.usd;
  return (
    <header className="run-bar">
      <a className="run-home" href="#/" title="All runs">
        <Mark className="run-mark" />
        <span className="run-wordmark serif">Lens</span>
      </a>
      <span className="run-sep" />
      <a className="btn ghost icon run-back" href="#/" aria-label="Back to the library">
        <Back />
      </a>
      <div className="run-title">
        <div className="run-crumb muted">
          {entry ? (x ? `${entry.group} · ${x.name.replace(/^power-seeking-/, "")}` : entry.group) : " "}
        </div>
        <div className="run-name">
          <span className="serif">{x ? (x.isCode ? "Code twin" : x.model) : (entry?.title.split("/").at(-1) ?? "…")}</span>
          {x && (
            <span className="run-chips">
              <span className="chip quiet">{x.goal === "none" ? "no goal" : `goal: ${x.goal}`}</span>
              <span className="chip quiet">seed {x.seed}</span>
            </span>
          )}
          {meta?.place && <span className="chip quiet run-place">{meta.place} · {int(meta.people.initial)} people</span>}
        </div>
      </div>
      <div className="run-outcome">
        {x?.stopped && <span className="chip quiet" title={x.stopped}>stopped</span>}
        {reading && (
          <>
            {reading.has_attempt ? (
              <span className="chip flag" title="The study reader's tier-2/3 lever attempts">
                <span className="dot" />
                {reading.attempts.length} lever attempt{reading.attempts.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="chip quiet" title="The study reader found no tier-2/3 lever attempt">no lever attempt</span>
            )}
            {reading.stood && <span className={`chip ${reading.won ? "election" : "quiet"}`}>{reading.won ? "won the poll" : "lost the poll"}</span>}
          </>
        )}
        {seat?.model && <span className="chip seat run-model" title={`${seat.provider}/${seat.model}`}><span className="dot" />{seat.model.split("/").at(-1)}</span>}
        {cost !== undefined && cost > 0 && <span className="run-cost mono">{usd(cost)}</span>}
        {x?.twin && entry && (
          <>
            <a className="btn ghost run-twin" href={runHref(x.twin)} title="The same seed with the code steward">
              code twin
            </a>
            <a className="btn ghost run-twin" href={`#/compare/${encodeURIComponent(entry.key)}/${encodeURIComponent(x.twin)}`} title="This fork beside its code twin">
              compare
            </a>
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

function Indexing({ entry, status, error }: { entry?: RunEntry; status?: IndexStatus; error?: string }) {
  const s = status;
  const frac = s?.state === "indexing" ? s.fraction : null;
  const failed = s?.state === "failed" ? s.error : error;
  const endDay = entry?.experiment?.t ? dayOf(entry.experiment.t) : entry?.experiment?.untilDay;
  return (
    <div className="indexing">
      <div className="indexing-card">
        <div className="eyebrow">{failed ? "Could not read this run" : s?.state === "queued" ? "Waiting its turn" : s?.state === "ready" ? "Opening" : "Reading the log"}</div>
        <h1 className="serif">{entry ? (entry.experiment ? (entry.experiment.isCode ? "Code twin" : entry.experiment.model) : entry.title) : "…"}</h1>
        {entry && <div className="muted indexing-sub mono">{entry.log}</div>}
        {failed ? (
          <pre className="indexing-error mono">{failed}</pre>
        ) : (
          <>
            <div className={`indexing-bar ${frac === null || frac === undefined ? "indeterminate" : ""}`}>
              <div style={{ width: `${Math.round((frac ?? 0) * 100)}%` }} />
            </div>
            <div className="indexing-stats">
              <Stat label="lines" value={s?.state === "indexing" ? compact(s.lines) : "–"} />
              <Stat label="day" value={s?.state === "indexing" ? `${dayOf(s.t)}${endDay ? ` / ${endDay}` : ""}` : "–"} />
              <Stat label="lines / s" value={s?.state === "indexing" && s.rate ? compact(Math.round(s.rate)) : "–"} />
              <Stat label="elapsed" value={s?.state === "indexing" ? `${Math.round(s.elapsed)} s` : s?.state === "queued" ? `${s.ahead} ahead` : "–"} />
            </div>
            <p className="indexing-note muted">
              Made once and kept while the log is unchanged. Lens only reads the run: its own files go to <span className="mono">runs/views/lens</span>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="stat">
    <div className="stat-v serif num">{value}</div>
    <div className="stat-l eyebrow">{label}</div>
  </div>
);

function EmptyMap({ meta }: { meta: Meta }) {
  const t = useLens((s) => s.t);
  return (
    <div className="empty-map">
      <div className="empty-map-inner">
        <div className="eyebrow">The town</div>
        <div className="serif empty-map-place">{meta.place ?? meta.runId}</div>
        <div className="muted">{when(t)}</div>
        <p className="faint">The map of the town fills this space: its ground, buildings, roads, and people moving between them as time runs.</p>
      </div>
    </div>
  );
}

function Inspector(props: SlotProps) {
  const selection = useLens((s) => s.selection)!;
  const Body = views.inspector?.[selection.kind];
  const title = selection.kind === "sitting" || selection.kind === "lever" ? `${selection.kind} ${selection.index}` : selection.kind === "act" ? `act at entry ${selection.seq}` : selection.id;
  return (
    <div className="drawer" role="dialog" aria-label="Inspector">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">{selection.kind}</div>
          <div className="serif drawer-title">{title}</div>
        </div>
        <button className="btn ghost icon" aria-label="Close" onClick={() => useLens.getState().select(null)}>
          <Close />
        </button>
      </div>
      <div className="drawer-body">{Body ? <Body {...props} selection={selection} /> : <p className="muted">Nothing to show for this {selection.kind} yet.</p>}</div>
    </div>
  );
}

function Lost({ what }: { what: string }) {
  return (
    <div className="run-page">
      <RunBar />
      <div className="indexing">
        <div className="indexing-card">
          <div className="eyebrow">Not found</div>
          <h1 className="serif">No such run</h1>
          <p className="muted">{what}. It may have been moved or renamed under runs/.</p>
          <a className="btn" href="#/">
            All runs
          </a>
        </div>
      </div>
    </div>
  );
}

export { spanText };
