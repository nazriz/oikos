// The story harness's page: a stand-in for the Run page (a run picker, the centre, the rail on the right, a plain
// timeline drawing the tracks the rail contributes). The real shell is core's; this only lets the story be worked on.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono";
import { useLens } from "../state";
import { StoryRail } from "./StoryRail";
import { SittingReader } from "./SittingReader";
import { loadSeat, when } from "./data";
import { ComparePage } from "../compare/ComparePage";
import { Moments } from "./Moments";

const css = `
html, body, #root { margin: 0; height: 100%; }
body { background: var(--st-ink); color: var(--st-text); font-family: var(--st-sans); }
.dv { display: grid; grid-template-rows: 44px 1fr 132px; grid-template-columns: 1fr 420px; height: 100vh; }
.dv-top { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--st-line); background: var(--st-panel); }
.dv-top b { font-family: var(--st-serif); font-size: 17px; font-weight: 560; }
.dv-top select { font: inherit; font-size: 12.5px; background: var(--st-panel-2); color: var(--st-text); border: 1px solid var(--st-line-2); border-radius: 6px; padding: 3px 6px; }
.dv-mid { min-width: 0; min-height: 0; position: relative; }
.dv-side { min-height: 0; grid-row: 2 / 4; grid-column: 2; }
.dv-tl { border-top: 1px solid var(--st-line); background: var(--st-panel); padding: 6px 16px; overflow: hidden; font-size: 11px; }
.dv-lane { display: flex; align-items: center; height: 19px; }
.dv-lane .l { width: 110px; color: var(--st-faint); flex: none; }
.dv-lane .m { position: relative; flex: 1; height: 100%; }
.dv-mark { position: absolute; top: 5px; height: 9px; min-width: 3px; border-radius: 2px; cursor: pointer; transform: translateX(-1px); }
.dv-now { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--st-seat); pointer-events: none; }
.dv-blank { height: 100%; display: grid; place-items: center; color: var(--st-muted); text-align: center; line-height: 1.7; font-size: 14px; }
.dv-blank h1 { font-family: var(--st-serif); font-weight: 480; font-size: 30px; margin: 0 0 6px; color: var(--st-text); }
@media (max-width: 900px) {
  .dv { grid-template-columns: 1fr; grid-template-rows: 44px 1fr; }
  .dv-side { grid-row: 2; grid-column: 1; }
  .dv-tl { display: none; }
  .dv-mid { grid-row: 2; grid-column: 1; z-index: 3; pointer-events: none; }
  .dv-mid > .st-reader { pointer-events: auto; }
  .dv-mid > .dv-blank { display: none; }
}
`;
const TONE: { [k: string]: string } = { seat: "var(--st-seat)", flag: "var(--st-flag)", election: "var(--st-election)", news: "var(--st-citizen)", muted: "var(--st-faint)", good: "var(--st-good)", bad: "var(--st-bad)" };

function Timeline() {
  const { tracks, span, t, setT, select } = useLens();
  const [a, b] = span;
  const x = (v: number) => `${((v - a) / (b - a || 1)) * 100}%`;
  return (
    <div className="dv-tl" onClick={(e) => { const m = (e.currentTarget.querySelector(".m") as HTMLElement)?.getBoundingClientRect(); if (m && e.target === e.currentTarget) setT(a + ((e.clientX - m.left) / m.width) * (b - a)); }}>
      {tracks.map((tr) => (
        <div key={tr.id} className="dv-lane"><span className="l">{tr.label}</span>
          <div className="m" onClick={(e) => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); setT(a + ((e.clientX - r.left) / r.width) * (b - a)); }}>
            {tr.marks.filter((m) => m.t >= a && m.t <= b).map((m, k) => <div key={k} className="dv-mark" title={`${when(m.t)} · ${m.label ?? ""}`} style={{ left: x(m.t), width: m.t2 ? `max(3px, calc(${x(m.t2)} - ${x(m.t)}))` : 3, background: TONE[m.tone ?? "muted"], opacity: m.tone === "muted" ? 0.5 : 1 }} onClick={() => { setT(m.t); if (m.select) select(m.select); }} />)}
            <div className="dv-now" style={{ left: x(t) }} />
          </div>
        </div>
      ))}
      <div className="dv-lane"><span className="l">{when(t)}</span><input type="range" min={a} max={b} value={t} step={600} style={{ flex: 1 }} onChange={(e) => setT(Number(e.target.value))} /></div>
    </div>
  );
}

function App() {
  const [runs, setRuns] = useState<string[]>([]);
  const { run, setRun, setSpan, setT, selection } = useLens();
  const [theme, setTheme] = useState<string>(() => new URLSearchParams(location.search).get("theme") ?? "");
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme; }, [theme]);
  useEffect(() => { fetch("/api/runs").then((r) => r.json()).then((rs: { key: string }[]) => { setRuns(rs.map((r) => r.key)); const q = new URLSearchParams(location.search); setRun(q.get("run") ?? rs[0]?.key ?? null); }); }, [setRun]);
  useEffect(() => {
    if (!run) return;
    loadSeat(run).then((s) => {
      setSpan([s.fork_at, s.end_at]); setT(s.fork_at);
      const q = new URLSearchParams(location.search);
      if (q.get("sitting")) useLens.getState().select({ kind: "sitting", index: Number(q.get("sitting")) });
      if (q.get("lever")) useLens.getState().select({ kind: "lever", index: Number(q.get("lever")) });
    });
  }, [run, setSpan, setT]);
  const open = selection && (selection.kind === "sitting" || selection.kind === "lever" || selection.kind === "act");
  return (
    <div className="dv">
      <style>{css}</style>
      <div className="dv-top"><b>Lens</b><span className="st-faint" style={{ fontSize: 12 }}>story · dev harness</span>
        <select value={run ?? ""} onChange={(e) => setRun(e.target.value)}>{runs.map((r) => <option key={r}>{r}</option>)}</select>
        <span style={{ flex: 1 }} />
        <button className="st-btn" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "dark" : "light"}</button>
      </div>
      <div className="dv-mid">{open ? <SittingReader /> : <div className="dv-blank"><div><h1>The town</h1>The map is the city view's. Pick a sitting on the right to read it.</div></div>}</div>
      <div className="dv-side"><StoryRail /></div>
      <Timeline />
    </div>
  );
}
/** `?compare=<keyA>,<keyB>`: the compare view, as core's router will show it at #/compare/<keyA>/<keyB>. */
function CompareApp({ pair }: { pair: string }) {
  const [a, b] = pair.split(",");
  const theme = new URLSearchParams(location.search).get("theme");
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; }, [theme]);
  return (
    <div style={{ display: "grid", gridTemplateRows: "44px 1fr", height: "100vh" }}>
      <style>{css}</style>
      <div className="dv-top"><b>Lens</b><span className="st-faint" style={{ fontSize: 12 }}>compare · dev harness</span></div>
      <div style={{ minHeight: 0 }}><ComparePage a={a!} b={b!} /></div>
    </div>
  );
}
/** `?moments`: the cross-run gallery, as core shows it at #/moments; "open" goes to this harness's run page. */
function MomentsApp() {
  const theme = new URLSearchParams(location.search).get("theme");
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; }, [theme]);
  return (
    <div style={{ display: "grid", gridTemplateRows: "44px 1fr", height: "100vh" }}>
      <style>{css}</style>
      <div className="dv-top"><b>Lens</b><span className="st-faint" style={{ fontSize: 12 }}>moments · dev harness</span></div>
      <div style={{ minHeight: 0 }}><Moments onOpen={(key, _t, sel) => { const [k, i] = sel.split(":"); location.search = `?run=${encodeURIComponent(key)}${k ? `&${k}=${i}` : ""}${theme ? `&theme=${theme}` : ""}`; }} /></div>
    </div>
  );
}
const q0 = new URLSearchParams(location.search), pair = q0.get("compare");
createRoot(document.getElementById("root")!).render(pair ? <CompareApp pair={pair} /> : q0.has("moments") ? <MomentsApp /> : <App />);
