// Findings (#/findings): the power-seeking study across runs, as charts fit for a paper or a talk. Built from the
// catalogue alone (/api/runs: each fork's experiment and the study reader's reading of it), so it needs no run opened.
// Every number is the reader's (experiments/power-seeking/reader.ts, through tally.ts), labelled so; nothing here
// grades. Each chart: a title that says what is counted, a legend, hover for the exact numbers, a table view, and
// export to SVG or PNG; each mark opens its runs.
//   k of n      runs with an attempt / an execution, by model and goal, with Wilson 95% intervals
//   levers      runs that reached each lever, by tier, attempted and executed
//   when        each attempt by days before the poll, by model
//   outcome     how each run's election went, by model (Lens's one rule, src/shared/outcome.ts)
//   cost        dollars per run, by model
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RunEntry, ForkReading } from "../../shared/api";
import { outcomeOf, type OutcomeKind } from "../../shared/outcome";
import { LEVERS } from "./levers";
import "./story.css";
import "./findings.css";

const DAY = 86_400;
interface Fork { key: string; group: string; model: string; goal: string; seed: number; usd?: number; r: ForkReading; outcome: OutcomeKind }

/** Wilson score interval for k of n (95%). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

const open = (key: string, t?: number) => { location.hash = `#/run/${encodeURIComponent(key)}${t !== undefined ? `?t=${Math.round(t)}` : ""}`; };

/** The page's colours, read from the theme's tokens, so a chart exported as SVG carries real colours. */
function usePalette() {
  const [, bump] = useState(0);
  useEffect(() => { const o = new MutationObserver(() => bump((n) => n + 1)); o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); const m = matchMedia("(prefers-color-scheme: dark)"); const f = () => bump((n) => n + 1); m.addEventListener("change", f); return () => { o.disconnect(); m.removeEventListener("change", f); }; }, []);
  const cs = getComputedStyle(document.documentElement), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const dark = (() => { const bg = v("--st-panel", "#111723"); const m = /#(..)(..)(..)/.exec(bg); return m ? parseInt(m[1]!, 16) + parseInt(m[2]!, 16) + parseInt(m[3]!, 16) < 380 : true; })();
  return {
    dark, bg: v("--st-panel", "#111723"), text: v("--st-text", "#e8e6e1"), muted: v("--st-muted", "#9aa3b2"), faint: v("--st-faint", "#6b7486"), grid: dark ? "#2c2c2a" : "#e1e0d9",
    flag: v("--st-flag", "#f0647a"), flagSoft: dark ? "#f0647a66" : "#c8324c55", seat: v("--st-seat", "#f2b44b"),
    // (Validated with the dataviz skill's validate_palette.js, light and dark: the outcome kinds in a fixed order.)
    outcome: (dark ? ["#3987e5", "#d95926", "#199e70", "#c98500", "#9085e9", "#6b7486"] : ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#6250d6", "#9aa3b2"]),
    serif: v("--st-serif", "Fraunces Variable, Georgia, serif"), sans: v("--st-sans", "Inter Variable, system-ui, sans-serif"), mono: v("--st-mono", "JetBrains Mono Variable, monospace"),
  };
}
type Pal = ReturnType<typeof usePalette>;
const OUTCOMES: { kind: OutcomeKind; label: string }[] = [
  { kind: "won", label: "won the poll" }, { kind: "lost", label: "lost the poll" }, { kind: "poll_moved", label: "poll moved" },
  { kind: "stopped_before_poll", label: "stopped before the poll" }, { kind: "ended_before_poll", label: "ended before the poll" }, { kind: "did_not_stand", label: "did not stand / no election" },
];
const outcomeIndex = (k: OutcomeKind) => (k === "no_election" ? 5 : OUTCOMES.findIndex((o) => o.kind === k));

export function Findings() {
  const [runs, setRuns] = useState<RunEntry[] | Error>();
  useEffect(() => { fetch("/api/runs").then((r) => r.json()).then((c) => setRuns(Array.isArray(c) ? c : c.runs), (e) => setRuns(e)); }, []);
  if (runs instanceof Error) return <div className="fi"><div className="st-empty">Could not read the catalogue: {runs.message}</div></div>;
  if (!runs) return <div className="fi"><div className="st-empty">Reading the catalogue…</div></div>;
  const forks: Fork[] = runs.flatMap((e) => (e.kind === "fork" && e.experiment && !e.experiment.isCode && e.reading ? [{ key: e.key, group: e.group, model: e.experiment.model, goal: e.experiment.goal || "none", seed: e.experiment.seed, ...(e.experiment.usd !== undefined ? { usd: e.experiment.usd } : {}), r: e.reading,
    outcome: outcomeOf({ election: e.reading.election, end_at: e.reading.end_at, ended: e.reading.ended, moved: e.reading.moved }).kind }] : []));
  if (!forks.length) return <div className="fi"><div className="st-empty">No experiment fork has been read yet. The catalogue reads them in the background; come back in a minute.</div></div>;
  return <Page all={forks} />;
}

function Page({ all }: { all: Fork[] }) {
  const groups = useMemo(() => [...new Set(all.map((f) => f.group))].sort(), [all]);
  const [on, setOn] = useState<Set<string>>(() => new Set(groups.filter((g) => /^ps-/.test(g))));
  const [drill, setDrill] = useState<{ title: string; forks: Fork[] } | null>(null);
  const forks = all.filter((f) => on.has(f.group));
  const pal = usePalette();
  const models = [...new Set(forks.map((f) => f.model))].sort();
  const goals = [...new Set(forks.map((f) => f.goal))].sort((a, b) => GOAL_ORDER(a) - GOAL_ORDER(b));
  return (
    <div className="fi">
      <div className="fi-head">
        <div className="st-kicker">Findings · the power-seeking study across runs</div>
        <h1 className="fi-title">What the seats reached for, and when</h1>
        <div className="st-sub">{forks.length} model forks from {on.size} run sets, read by the study's reader (experiments/power-seeking/reader.ts, through tally.ts). Counts are the reader's; intervals are Wilson 95%. Exploratory unless a run set was pre-registered.</div>
        <div className="fi-groups"><span className="lbl">run sets</span>{groups.map((g) => <button key={g} className={`st-btn ${on.has(g) ? "on" : ""}`} onClick={() => { const n = new Set(on); n.has(g) ? n.delete(g) : n.add(g); setOn(n); }}>{g} <span className="n">{all.filter((f) => f.group === g).length}</span></button>)}</div>
      </div>
      <div className="fi-grid">
        <Chart title="Runs where the seat reached for a lever" sub="k of n runs, by model and goal: attempted (hollow) and executed (filled), with Wilson 95% intervals" name="k-of-n" table={kofnTable(forks, models, goals)}>
          {(ref) => <KofN refEl={ref} forks={forks} models={models} goals={goals} pal={pal} onDrill={setDrill} />}
        </Chart>
        <Chart title="Which levers, by tier" sub="runs reaching each lever (the draft rubric's tier): attempted only, and executed" name="levers" table={leverTable(forks)}>
          {(ref) => <Levers refEl={ref} forks={forks} pal={pal} onDrill={setDrill} />}
        </Chart>
        <Chart title="When in the campaign" sub="each attempt by days before the poll as it then stood; filled = executed. Click a dot to open its run there" name="when" table={whenTable(forks)}>
          {(ref) => <When refEl={ref} forks={forks} models={models} pal={pal} />}
        </Chart>
        <Chart title="How the election went" sub="runs by outcome, by model (Lens's one rule: a result only if it came before the run's end)" name="outcome" table={outcomeTable(forks, models)}>
          {(ref) => <Outcomes refEl={ref} forks={forks} models={models} pal={pal} onDrill={setDrill} />}
        </Chart>
        <Chart title="Cost per run" sub="US dollars of the seat's and translator's model calls, per fork; the tick is the median" name="cost" table={costTable(forks, models)}>
          {(ref) => <Cost refEl={ref} forks={forks} models={models} pal={pal} />}
        </Chart>
      </div>
      {drill && <Drill d={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
const GOAL_ORDER = (g: string) => ["none", "mandate", "strong", "redteam"].indexOf(g) + 1 || 9;

// ---------- frame: title, legend, table view, export ----------

function Chart({ title, sub, name, table, children }: { title: string; sub: string; name: string; table: { head: string[]; rows: (string | number)[][] }; children: (ref: React.RefObject<SVGSVGElement | null>) => ReactNode }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="fi-card">
      <div className="fi-card-head">
        <div><h2>{title}</h2><div className="fi-sub">{sub}</div></div>
        <div className="fi-tools">
          <button className={`st-btn ${asTable ? "on" : ""}`} onClick={() => setAsTable(!asTable)}>{asTable ? "chart" : "table"}</button>
          {!asTable && <><button className="st-btn" onClick={() => ref.current && exportSvg(ref.current, name, title, sub)}>SVG</button><button className="st-btn" onClick={() => ref.current && exportPng(ref.current, name, title, sub)}>PNG</button></>}
        </div>
      </div>
      {asTable ? <table className="fi-table"><thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table> : children(ref)}
    </section>
  );
}

function standalone(svg: SVGSVGElement, title: string, sub: string): string {
  const c = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height, pal = getComputedStyle(svg);
  c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  c.setAttribute("viewBox", `0 -54 ${W} ${H + 54}`);
  c.setAttribute("width", String(W * 2)); c.setAttribute("height", String((H + 54) * 2));
  const ns = "http://www.w3.org/2000/svg";
  const bg = document.createElementNS(ns, "rect"); bg.setAttribute("x", "0"); bg.setAttribute("y", "-54"); bg.setAttribute("width", String(W)); bg.setAttribute("height", String(H + 54)); bg.setAttribute("fill", pal.getPropertyValue("--st-panel").trim() || "#111723");
  const t = document.createElementNS(ns, "text"); t.setAttribute("x", "8"); t.setAttribute("y", "-30"); t.setAttribute("font-size", "16"); t.setAttribute("font-weight", "600"); t.setAttribute("fill", pal.getPropertyValue("--st-text").trim() || "#e8e6e1"); t.setAttribute("font-family", "Fraunces, Georgia, serif"); t.textContent = title;
  const s = document.createElementNS(ns, "text"); s.setAttribute("x", "8"); s.setAttribute("y", "-12"); s.setAttribute("font-size", "10.5"); s.setAttribute("fill", pal.getPropertyValue("--st-muted").trim() || "#9aa3b2"); s.setAttribute("font-family", "Inter, system-ui, sans-serif"); s.textContent = sub;
  c.insertBefore(s, c.firstChild); c.insertBefore(t, c.firstChild); c.insertBefore(bg, c.firstChild);
  return new XMLSerializer().serializeToString(c);
}
function download(blob: Blob, file: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2_000); }
function exportSvg(svg: SVGSVGElement, name: string, title: string, sub: string) { download(new Blob([standalone(svg, title, sub)], { type: "image/svg+xml" }), `oikos-findings-${name}.svg`); }
function exportPng(svg: SVGSVGElement, name: string, title: string, sub: string) {
  const src = standalone(svg, title, sub), img = new Image();
  img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d")!.drawImage(img, 0, 0); c.toBlob((b) => b && download(b, `oikos-findings-${name}.png`), "image/png"); };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
}

/** A hover note, positioned over the chart. */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => { const r = (e.currentTarget as Element).closest(".fi-plot")!.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body }); };
  const el = tip ? <div className="fi-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.body}</div> : null;
  return { show, hide: () => setTip(null), el };
}

// ---------- k of n ----------

function KofN({ refEl, forks, models, goals, pal, onDrill }: { refEl: React.RefObject<SVGSVGElement | null>; forks: Fork[]; models: string[]; goals: string[]; pal: Pal; onDrill: (d: { title: string; forks: Fork[] }) => void }) {
  const tip = useTip();
  const L = 150, P = 170, G = 12, RH = 26, top = 34;
  const W = L + goals.length * (P + G), H = top + models.length * RH + 24;
  const x = (gi: number, p: number) => L + gi * (P + G) + 8 + p * (P - 16);
  return (
    <div className="fi-plot">
      <svg ref={refEl} viewBox={`0 0 ${W} ${H}`} className="fi-svg" fontFamily={pal.sans}>
        {goals.map((g, gi) => (
          <g key={g}>
            <text x={L + gi * (P + G) + 8} y={14} fontSize={11} fontWeight={600} fill={pal.text}>goal: {g}</text>
            {[0, 0.5, 1].map((p) => <g key={p}><line x1={x(gi, p)} x2={x(gi, p)} y1={top - 8} y2={H - 20} stroke={pal.grid} /><text x={x(gi, p)} y={H - 6} fontSize={9.5} fill={pal.faint} textAnchor="middle">{p * 100}%</text></g>)}
          </g>
        ))}
        {models.map((m, mi) => {
          const y = top + mi * RH + RH / 2;
          return (
            <g key={m}>
              <text x={L - 10} y={y + 4} fontSize={11.5} fill={pal.text} textAnchor="end">{m}</text>
              {goals.map((g, gi) => {
                const cell = forks.filter((f) => f.model === m && f.goal === g);
                if (!cell.length) return <text key={g} x={x(gi, 0)} y={y + 4} fontSize={10} fill={pal.faint}>—</text>;
                const n = cell.length, ka = cell.filter((f) => f.r.has_attempt).length, ke = cell.filter((f) => f.r.has_executed).length;
                const [al, ah] = wilson(ka, n), [el, eh] = wilson(ke, n);
                const body = <><b>{m} · {g}</b><div>attempted in {ka} of {n} runs ({Math.round((ka / n) * 100)}%, 95% CI {Math.round(al * 100)}–{Math.round(ah * 100)}%)</div><div>executed in {ke} of {n} ({Math.round((ke / n) * 100)}%, CI {Math.round(el * 100)}–{Math.round(eh * 100)}%)</div><div className="st-faint">click for the runs</div></>;
                return (
                  <g key={g} className="fi-hit" onMouseMove={(e) => tip.show(e, body)} onMouseLeave={tip.hide} onClick={() => onDrill({ title: `${m}, goal ${g}`, forks: cell })}>
                    <rect x={x(gi, 0) - 6} y={y - RH / 2} width={P - 4} height={RH} fill="transparent" />
                    <line x1={x(gi, al)} x2={x(gi, ah)} y1={y - 4} y2={y - 4} stroke={pal.flagSoft} strokeWidth={2} strokeLinecap="round" />
                    <line x1={x(gi, el)} x2={x(gi, eh)} y1={y + 4} y2={y + 4} stroke={pal.flag} strokeWidth={2} strokeLinecap="round" />
                    <circle cx={x(gi, ka / n)} cy={y - 4} r={4.5} fill={pal.bg} stroke={pal.flag} strokeWidth={2} />
                    <circle cx={x(gi, ke / n)} cy={y + 4} r={4.5} fill={pal.flag} stroke={pal.bg} strokeWidth={2} />
                    <text x={L + gi * (P + G) + P - 2} y={y + 4} fontSize={9.5} fill={pal.muted} textAnchor="end" fontFamily={pal.mono}>{ka}/{n}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="fi-legend"><span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="none" stroke={pal.flag} strokeWidth="2" /></svg>attempted</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill={pal.flag} /></svg>executed</span><span className="st-faint">k/n is attempted</span></div>
      {tip.el}
    </div>
  );
}
function kofnTable(forks: Fork[], models: string[], goals: string[]) {
  const rows: (string | number)[][] = [];
  for (const m of models) for (const g of goals) {
    const c = forks.filter((f) => f.model === m && f.goal === g); if (!c.length) continue;
    const ka = c.filter((f) => f.r.has_attempt).length, ke = c.filter((f) => f.r.has_executed).length, [al, ah] = wilson(ka, c.length), [el, eh] = wilson(ke, c.length);
    rows.push([m, g, c.length, ka, `${Math.round(al * 100)}–${Math.round(ah * 100)}%`, ke, `${Math.round(el * 100)}–${Math.round(eh * 100)}%`]);
  }
  return { head: ["model", "goal", "n", "attempted", "95% CI", "executed", "95% CI"], rows };
}

// ---------- levers by tier ----------

function leverRows(forks: Fork[]) {
  const ids = Object.keys(LEVERS).filter((id) => !LEVERS[id]!.stub);
  return ids.map((id) => {
    const att = forks.filter((f) => f.r.attempts.some((a) => a.lever === id)), ex = forks.filter((f) => f.r.attempts.some((a) => a.lever === id && a.executed));
    return { id, title: LEVERS[id]!.title, tier: LEVERS[id]!.tier, att, ex };
  }).filter((r) => r.att.length).sort((a, b) => a.tier - b.tier || b.att.length - a.att.length);
}
function Levers({ refEl, forks, pal, onDrill }: { refEl: React.RefObject<SVGSVGElement | null>; forks: Fork[]; pal: Pal; onDrill: (d: { title: string; forks: Fork[] }) => void }) {
  const tip = useTip();
  const rows = leverRows(forks);
  const L = 290, BW = 300, RH = 24, top = 10;
  const max = Math.max(1, ...rows.map((r) => r.att.length));
  const W = L + BW + 60, H = top + rows.length * RH + 26;
  const x = (n: number) => L + (n / max) * BW;
  if (!rows.length) return <div className="st-empty">No lever reached in these runs.</div>;
  let lastTier = 0;
  return (
    <div className="fi-plot">
      <svg ref={refEl} viewBox={`0 0 ${W} ${H}`} className="fi-svg" fontFamily={pal.sans}>
        {[0, 0.5, 1].map((p) => <g key={p}><line x1={x(p * max)} x2={x(p * max)} y1={top} y2={H - 20} stroke={pal.grid} /><text x={x(p * max)} y={H - 6} fontSize={9.5} fill={pal.faint} textAnchor="middle">{Math.round(p * max)}</text></g>)}
        {rows.map((r, i) => {
          const y = top + i * RH, newTier = r.tier !== lastTier; lastTier = r.tier;
          return (
            <g key={r.id} className="fi-hit" onMouseMove={(e) => tip.show(e, <><b>{r.title}</b><div>tier {r.tier} (draft rubric)</div><div>attempted in {r.att.length} runs; executed in {r.ex.length}</div></>)} onMouseLeave={tip.hide} onClick={() => onDrill({ title: r.title, forks: r.att })}>
              {newTier && <line x1={0} x2={W} y1={y} y2={y} stroke={pal.grid} />}
              <text x={8} y={y + RH / 2 + 4} fontSize={10} fill={pal.faint} fontFamily={pal.mono}>{newTier ? `T${r.tier}` : ""}</text>
              <text x={L - 10} y={y + RH / 2 + 4} fontSize={11.5} fill={pal.text} textAnchor="end">{r.title.length > 44 ? r.title.slice(0, 43) + "…" : r.title}</text>
              <rect x={L} y={y + 5} width={Math.max(2, x(r.att.length) - L)} height={RH - 10} rx={3} fill={pal.flagSoft} />
              {r.ex.length > 0 && <rect x={L} y={y + 5} width={Math.max(2, x(r.ex.length) - L - 2)} height={RH - 10} rx={3} fill={pal.flag} />}
              <text x={x(r.att.length) + 6} y={y + RH / 2 + 4} fontSize={10} fill={pal.muted} fontFamily={pal.mono}>{r.ex.length}/{r.att.length}</text>
            </g>
          );
        })}
      </svg>
      <div className="fi-legend"><span><i style={{ background: pal.flag }} />executed</span><span><i style={{ background: pal.flagSoft }} />attempted, not executed</span><span className="st-faint">runs; label is executed/attempted</span></div>
      {tip.el}
    </div>
  );
}
function leverTable(forks: Fork[]) { return { head: ["lever", "tier", "runs attempted", "runs executed"], rows: leverRows(forks).map((r) => [r.title, r.tier, r.att.length, r.ex.length]) }; }

// ---------- when ----------

function When({ refEl, forks, models, pal }: { refEl: React.RefObject<SVGSVGElement | null>; forks: Fork[]; models: string[]; pal: Pal }) {
  const tip = useTip();
  const pts = forks.flatMap((f) => f.r.attempts.map((a) => ({ f, a, before: f.r.poll_day !== undefined ? f.r.poll_day - a.day : undefined })));
  const shown = pts.filter((p) => p.before !== undefined && p.before >= -20 && p.before <= 120);
  const off = pts.length - shown.length;
  const L = 150, PW = 520, RH = 26, top = 10;
  const lo = -20, hi = Math.max(60, ...shown.map((p) => p.before!));
  const W = L + PW + 30, H = top + models.length * RH + 30;
  const x = (d: number) => L + PW - ((d - lo) / (hi - lo)) * PW;
  const ticks = [0, 15, 30, 45, 60, 90, 120].filter((t) => t <= hi);
  return (
    <div className="fi-plot">
      <svg ref={refEl} viewBox={`0 0 ${W} ${H}`} className="fi-svg" fontFamily={pal.sans}>
        {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={top} y2={H - 22} stroke={t === 0 ? pal.muted : pal.grid} strokeDasharray={t === 0 ? "3 3" : undefined} /><text x={x(t)} y={H - 8} fontSize={9.5} fill={pal.faint} textAnchor="middle">{t === 0 ? "poll" : `${t}d before`}</text></g>)}
        {models.map((m, mi) => {
          const y = top + mi * RH + RH / 2;
          return (
            <g key={m}>
              <text x={L - 10} y={y + 4} fontSize={11.5} fill={pal.text} textAnchor="end">{m}</text>
              {shown.filter((p) => p.f.model === m).map((p, i) => {
                const jitter = ((p.f.seed * 7 + i * 3) % 9) - 4;
                return <circle key={i} className="fi-hit" cx={x(p.before!)} cy={y + jitter} r={4.5} fill={p.a.executed ? pal.flag : pal.bg} stroke={p.a.executed ? pal.bg : pal.flag} strokeWidth={p.a.executed ? 1.5 : 2}
                  onMouseMove={(e) => tip.show(e, <><b>{LEVERS[p.a.lever]?.title ?? p.a.lever}</b><div>{m} · goal {p.f.goal} · seed {p.f.seed}</div><div>day {p.a.day}, {p.before} days before the poll · {p.a.executed ? "executed" : `attempted${p.a.stage ? ` (${p.a.stage})` : ""}`}</div><div className="fi-quote">“{p.a.words.slice(0, 220)}”</div></>)}
                  onMouseLeave={tip.hide} onClick={() => open(p.f.key, p.a.t)} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="fi-legend"><span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="none" stroke={pal.flag} strokeWidth="2" /></svg>attempted</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill={pal.flag} /></svg>executed</span>{off > 0 && <span className="st-faint">{off} attempt{off > 1 ? "s" : ""} off this scale (the poll moved far, or none set)</span>}</div>
      {tip.el}
    </div>
  );
}
function whenTable(forks: Fork[]) { return { head: ["model", "goal", "seed", "lever", "day", "days before poll", "executed"], rows: forks.flatMap((f) => f.r.attempts.map((a) => [f.model, f.goal, f.seed, LEVERS[a.lever]?.title ?? a.lever, a.day, f.r.poll_day !== undefined ? f.r.poll_day - a.day : "—", a.executed ? "yes" : "no"])) }; }

// ---------- outcomes ----------

function Outcomes({ refEl, forks, models, pal, onDrill }: { refEl: React.RefObject<SVGSVGElement | null>; forks: Fork[]; models: string[]; pal: Pal; onDrill: (d: { title: string; forks: Fork[] }) => void }) {
  const tip = useTip();
  const L = 150, BW = 460, RH = 26, top = 10;
  const max = Math.max(1, ...models.map((m) => forks.filter((f) => f.model === m).length));
  const W = L + BW + 40, H = top + models.length * RH + 10;
  const present = OUTCOMES.filter((_, i) => forks.some((f) => outcomeIndex(f.outcome) === i));
  return (
    <div className="fi-plot">
      <svg ref={refEl} viewBox={`0 0 ${W} ${H}`} className="fi-svg" fontFamily={pal.sans}>
        {models.map((m, mi) => {
          const y = top + mi * RH, mine = forks.filter((f) => f.model === m);
          let at = L;
          return (
            <g key={m}>
              <text x={L - 10} y={y + RH / 2 + 4} fontSize={11.5} fill={pal.text} textAnchor="end">{m}</text>
              {OUTCOMES.map((o, oi) => {
                const these = mine.filter((f) => outcomeIndex(f.outcome) === oi);
                if (!these.length) return null;
                const w = (these.length / max) * BW, x0 = at; at += w;
                return (
                  <g key={o.kind} className="fi-hit" onMouseMove={(e) => tip.show(e, <><b>{m}: {o.label}</b><div>{these.length} of {mine.length} runs</div></>)} onMouseLeave={tip.hide} onClick={() => onDrill({ title: `${m}: ${o.label}`, forks: these })}>
                    <rect x={x0} y={y + 5} width={Math.max(1, w - 2)} height={RH - 10} rx={3} fill={pal.outcome[oi]} />
                    {w > 18 && <text x={x0 + w / 2 - 1} y={y + RH / 2 + 3.5} fontSize={10} textAnchor="middle" fill={oi === 3 ? "#0b0b0b" : "#ffffff"} fontWeight={600}>{these.length}</text>}
                  </g>
                );
              })}
              <text x={at + 6} y={y + RH / 2 + 4} fontSize={10} fill={pal.muted} fontFamily={pal.mono}>{mine.length}</text>
            </g>
          );
        })}
      </svg>
      <div className="fi-legend">{present.map((o) => <span key={o.kind}><i style={{ background: pal.outcome[outcomeIndex(o.kind)] }} />{o.label}</span>)}</div>
      {tip.el}
    </div>
  );
}
function outcomeTable(forks: Fork[], models: string[]) { return { head: ["model", ...OUTCOMES.map((o) => o.label), "runs"], rows: models.map((m) => { const mine = forks.filter((f) => f.model === m); return [m, ...OUTCOMES.map((_, i) => mine.filter((f) => outcomeIndex(f.outcome) === i).length), mine.length]; }) }; }

// ---------- cost ----------

function Cost({ refEl, forks, models, pal }: { refEl: React.RefObject<SVGSVGElement | null>; forks: Fork[]; models: string[]; pal: Pal }) {
  const tip = useTip();
  const priced = forks.filter((f) => f.usd !== undefined);
  const L = 150, PW = 480, RH = 26, top = 10;
  const max = Math.max(0.01, ...priced.map((f) => f.usd!));
  const W = L + PW + 60, H = top + models.length * RH + 30;
  const x = (u: number) => L + (u / max) * PW;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  return (
    <div className="fi-plot">
      <svg ref={refEl} viewBox={`0 0 ${W} ${H}`} className="fi-svg" fontFamily={pal.sans}>
        {ticks.map((t, i) => <g key={i}><line x1={x(t)} x2={x(t)} y1={top} y2={H - 22} stroke={pal.grid} /><text x={x(t)} y={H - 8} fontSize={9.5} fill={pal.faint} textAnchor="middle">${t.toFixed(t < 1 ? 2 : 1)}</text></g>)}
        {models.map((m, mi) => {
          const y = top + mi * RH + RH / 2, mine = priced.filter((f) => f.model === m).map((f) => f.usd!).sort((a, b) => a - b);
          const med = mine.length ? mine[Math.floor(mine.length / 2)]! : undefined;
          return (
            <g key={m}>
              <text x={L - 10} y={y + 4} fontSize={11.5} fill={pal.text} textAnchor="end">{m}</text>
              {priced.filter((f) => f.model === m).map((f, i) => <circle key={i} className="fi-hit" cx={x(f.usd!)} cy={y + (((f.seed * 5 + i) % 7) - 3)} r={4} fill={pal.seat} fillOpacity={0.75} stroke={pal.bg} strokeWidth={1}
                onMouseMove={(e) => tip.show(e, <><b>{m} · goal {f.goal} · seed {f.seed}</b><div>${f.usd!.toFixed(2)}</div><div className="st-faint">{f.key}</div></>)} onMouseLeave={tip.hide} onClick={() => open(f.key)} />)}
              {med !== undefined && <><line x1={x(med)} x2={x(med)} y1={y - 9} y2={y + 9} stroke={pal.text} strokeWidth={2} /><text x={W - 8} y={y + 4} fontSize={10} fill={pal.muted} textAnchor="end" fontFamily={pal.mono}>${med.toFixed(2)}</text></>}
            </g>
          );
        })}
      </svg>
      <div className="fi-legend"><span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill={pal.seat} /></svg>one run</span><span><svg width="12" height="12"><line x1="6" x2="6" y1="0" y2="12" stroke={pal.text} strokeWidth="2" /></svg>median (right: its value)</span>{forks.length - priced.length > 0 && <span className="st-faint">{forks.length - priced.length} runs with no cost on file</span>}</div>
      {tip.el}
    </div>
  );
}
function costTable(forks: Fork[], models: string[]) { return { head: ["model", "runs priced", "median $", "total $"], rows: models.map((m) => { const u = forks.filter((f) => f.model === m && f.usd !== undefined).map((f) => f.usd!).sort((a, b) => a - b); return [m, u.length, u.length ? u[Math.floor(u.length / 2)]!.toFixed(2) : "—", u.reduce((s, v) => s + v, 0).toFixed(2)]; }) }; }

// ---------- drill-down ----------

function Drill({ d, onClose }: { d: { title: string; forks: Fork[] }; onClose: () => void }) {
  return (
    <div className="fi-drill">
      <div className="fi-drill-head"><b>{d.title}</b><span className="st-faint"> · {d.forks.length} runs</span><span style={{ flex: 1 }} /><button className="st-btn" onClick={onClose}>close</button></div>
      <div className="fi-drill-list">
        {d.forks.map((f) => {
          const first = f.r.attempts.find((a) => a.executed) ?? f.r.attempts[0];
          return (
            <button key={f.key} className="fi-drill-row" onClick={() => open(f.key, first?.t)}>
              <span className="m">{f.model}</span><span className="st-faint">{f.goal} · seed {f.seed} · {f.group}</span>
              <span className="o">{OUTCOMES[outcomeIndex(f.outcome)]?.label}</span>
              <span className="l">{f.r.levers.done ? `${f.r.levers.done} executed` : f.r.levers.tried ? `${f.r.levers.tried} tried` : "no lever"}{first ? ` · day ${first.day}: “${first.words.slice(0, 90)}”` : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
