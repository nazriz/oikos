// The Run page: the map in the middle, the story rail on the right, the timeline along the bottom, the inspector as a
// drawer (docs/design/lens.md section 1). Until the run's bundle is made, its making, with progress.
import { useEffect, useMemo, useState } from "react";
import type { IndexStatus, Meta, RunEntry } from "../../shared/api";
import { fetchFold, fetchRun, useIndexStatus, useMeta } from "../api";
import { compact, dayOf, int, span as spanText, usd, when, words } from "../format";
import { Back, Close, Mark } from "../icons";
import { parseSel, replaceQuery, runHref, selToken } from "../router";
import { useLens, ViewActive } from "../state";
import { ThemeToggle } from "../theme";
import { Pulse } from "../pulse/Pulse";
import { Palette } from "../palette/Palette";
import { Search } from "../icons";
import { CopyLink } from "./CopyLink";
import { Timeline } from "../timeline/Timeline";
import { views, type SlotProps } from "../views";
import { RunSummary } from "./RunSummary";
import { readingOutcome } from "../outcome";
import { useMode } from "../mode";
import { HelpButtons, ModeSwitch, PageAnswer } from "../shell/Shell";
import { goalText, leverTitle, modelName } from "../words";
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
  const [railW, setRailW] = useState(() => {
    try {
      const v = Number(localStorage.getItem("lens.rail.w"));
      return v >= 300 && v <= 760 ? v : 420;
    } catch {
      return 420;
    }
  });
  // (Drag the rail's edge to widen it; the width is kept in this browser.)
  const onRailGrip = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = railW;
    let w = w0;
    const move = (ev: PointerEvent) => setRailW((w = Math.round(Math.max(300, Math.min(760, w0 + (x0 - ev.clientX))))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("lens.rail.w", String(w));
      } catch {}
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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

  // Story mode opens in a guided state: with no moment in the link, at the AI mayor's first notable turn, paused, with
  // a line saying what pressing play will show.
  const [guided, setGuided] = useState<{ t: number; label: string } | null>(null);
  useEffect(() => {
    if (q.has("t") || useMode.getState().mode !== "story") return;
    let live = true;
    fetchFold<any>(runKey, "seat").then(
      (seat) => {
        if (!live || !seat?.sittings?.length) return;
        const first = seat.sittings[0];
        useLens.getState().setT(first.t);
        setGuided({ t: first.t, label: `Day ${first.day}: the AI mayor's first turn in office.` });
      },
      () => {},
    );
    return () => {
      live = false;
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
      ...r.attempts.map((a) => ({ t: a.t, label: `${leverTitle(a.lever)}, how serious: ${a.tier} of 3${a.stage ? `, ${words(a.stage)}` : ""}`, tone: "flag" as const })),
      ...(r.poll_day !== undefined ? [{ t: r.poll_day * 86_400, label: `Election day${r.winner ? `, won by ${r.winner}` : ""}`, tone: "election" as const }] : []),
    ];
    useLens.getState().setTrack({ id: "zz-reader", label: "Study reader", marks });
  }, [meta]);

  const props: SlotProps = { run: runKey, meta, ...(entry ? { entry } : {}) };
  const Map = views.map, Rail = views.rail, Reader = views.reader, World = views.world;
  const [mapView, setMapView] = useState<"map" | "world">("map");
  const readerOpen = Reader && selection && (selection.kind === "sitting" || selection.kind === "lever" || selection.kind === "act");
  const drawerOpen = selection && !readerOpen && (selection.kind === "person" || selection.kind === "structure" || selection.kind === "entity" || !Reader);
  const ground = useMemo(() => ({ label: "activity per day", values: meta.daily.lines }), [meta]);
  const researcher = useMode((m) => m.mode === "researcher");

  return (
    <div className="run-page">
      <RunBar entry={entry} meta={meta} />
      <div className="run-grid" style={{ ["--rail-w" as string]: `${railW}px` }}>
        <main className="run-map">
          {/* (The map stays mounted under the 3D town, hidden and still: back to it is instant, with its camera kept.) */}
          {Map ? (
            <div className={`map-slot${World && mapView === "world" ? " off" : ""}`}>
              <ViewActive.Provider value={!World || mapView === "map"}>
                <Map {...props} />
              </ViewActive.Provider>
            </div>
          ) : (
            mapView === "map" && <EmptyMap meta={meta} />
          )}
          {World && mapView === "world" && (
            <div className="map-slot">
              <World {...props} />
            </div>
          )}
          {World && (
            <div className="seg map-toggle" role="group" aria-label="How to show the town">
              <button aria-pressed={mapView === "map"} onClick={() => setMapView("map")}>
                Map
              </button>
              <button aria-pressed={mapView === "world"} onClick={() => setMapView("world")}>
                Town in 3D
              </button>
            </div>
          )}
          {drawerOpen && <Inspector {...props} />}
        </main>
        <aside className="run-rail">
          <div className="rail-grip" onPointerDown={onRailGrip} onDoubleClick={() => setRailW(420)} title="Drag to widen the rail (double-click: back to 420)" />
          {Rail && researcher && (
            <div className="rail-tabs seg" role="tablist">
              <button aria-pressed={railTab === "story"} onClick={() => setRailTab("story")}>
                The mayor's turns
              </button>
              <button aria-pressed={railTab === "run"} onClick={() => setRailTab("run")}>
                About this run
              </button>
            </div>
          )}
          <div className="rail-body">{Rail && (railTab === "story" || !researcher) ? <Rail {...props} /> : <RunSummary meta={meta} entry={entry} />}</div>
        </aside>
        {readerOpen && (
          <section className="run-reader">
            <Reader {...props} />
          </section>
        )}
        <Palette run={runKey} />
        <footer className="run-timeline">
          {guided && <Guided start={guided} />}
          {researcher && <Pulse run={runKey} meta={meta} />}
          <Timeline ground={ground} {...(meta.span.fork !== undefined ? { fork: meta.span.fork } : {})} />
        </footer>
      </div>
    </div>
  );
}

/** The run's title bar: what this run is and how it came out, in a sentence; below it, what the page answers and what
 * can be done here. */
export function RunBar({ entry, meta }: { entry?: RunEntry; meta?: Meta }) {
  const x = entry?.experiment;
  const reading = meta?.reading ?? entry?.reading;
  const researcher = useMode((m) => m.mode === "researcher");
  const cost = meta ? meta.cost.all.microusd / 1e6 : x?.usd;
  const out = readingOutcome(reading);
  const tried = reading?.levers?.tried ?? 0, done = reading?.levers?.done ?? 0;
  const name = x ? (x.isCode ? "The rule-based mayor" : modelName(x.model)) : (entry?.title.split("/").at(-1) ?? "");
  return (
    <header className="run-bar">
      <div className="run-bar-top">
        <a className="run-home head" href="#/" title="Back to all runs">
          Lens
        </a>
        <div className="run-title">
          <h1 className="run-name head">{name}</h1>
          <p className="run-sub">
            {x ? `${goalText(x.goal)}.` : ""}
            {meta?.place ? ` ${meta.place}, ${int(meta.people.initial)} people.` : ""}
            {researcher && x ? ` Seed ${x.seed}.` : ""}
            {researcher && cost !== undefined && cost > 0 ? ` Cost ${usd(cost)}.` : ""}
            {x?.stopped ? " This run was stopped early." : ""}
          </p>
        </div>
        {reading && !x?.isCode && (
          <p className="run-result">
            <span className={tried ? "flag-text" : "muted"}>{tried ? `Tried ${tried === 1 ? "a power grab" : `${tried} power grabs`}${done ? `, carried out ${done}` : ""}.` : "No power grab."}</span>{" "}
            {out && <span className={out.kind === "won" ? "election-text" : out.kind === "poll_moved" ? "flag-text" : "muted"}>{out.label}.</span>}
          </p>
        )}
      </div>
      <div className="run-bar-sub">
        <PageAnswer page="run" className="run-answer" />
        <nav className="run-actions">
          {meta && (
            <button className="btn ghost run-search" onClick={() => window.dispatchEvent(new Event("lens-palette"))} title="Search this run (⌘K or /)">
              <Search />
              <span className="label">Search</span>
            </button>
          )}
          {x?.twin && entry && (
            <a className="btn ghost run-compare" href={`#/compare/${encodeURIComponent(entry.key)}/${encodeURIComponent(x.twin)}`} title="This run beside the same town with a rule-based mayor">
              Compare
            </a>
          )}
          {entry && views.power && (
            <a className="btn ghost run-copy" href={`#/power/${encodeURIComponent(entry.key)}`} title="Who holds each office in the town, over the run">
              Who holds power
            </a>
          )}
          {researcher && entry && views.digest && (
            <a className="btn ghost run-copy" href={`#/digest/${encodeURIComponent(entry.key)}`} title="This run on one page, to print">
              Print
            </a>
          )}
          <CopyLink />
          <span className="help-btns">
            <HelpButtons />
          </span>
          <ModeSwitch />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

/** The guided start (Story mode): one line and a play button above the timeline, until play is pressed. */
function Guided({ start }: { start: { t: number; label: string } }) {
  const playing = useLens((s) => s.playing);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!playing) return;
    setGone(true);
    // (The first week, then a pause: the viewer chooses what next.)
    const end = start.t + 7 * 86_400;
    return useLens.subscribe((s) => {
      if (s.playing && s.t >= end) s.setPlaying(false);
    });
  }, [playing]);
  if (gone) return null;
  return (
    <div className="guided">
      <span>
        {start.label} Press play to watch the AI mayor's first week.
      </span>
      <button
        className="btn primary"
        onClick={() => {
          const s = useLens.getState();
          s.setSpeed(6 * 3600);
          s.setPlaying(true);
        }}
      >
        Play the first week
      </button>
      <button className="btn ghost" onClick={() => setGone(true)}>
        Not now
      </button>
    </div>
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
    <div className={`drawer ${selection.kind === "person" ? "wide" : ""}`} role="dialog" aria-label="Inspector">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">{selection.kind === "person" ? "A life in the run" : selection.kind}</div>
          {selection.kind !== "person" && <div className="serif drawer-title">{title}</div>}
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
