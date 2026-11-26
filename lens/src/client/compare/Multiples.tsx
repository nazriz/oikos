// Small multiples: one card per count, both arms on one scale, the fork and the poll marked, the shared time as a
// cursor. Hovering a card reads both arms' values on that day and moves the shared time there.
import { useMemo, useState, type ReactElement } from "react";
import { useLens } from "../state";
import { worldDay } from "../story/data";

export interface Panel { id: string; title: string; note: string; a: number[]; b: number[]; money?: boolean; group?: string }

const DAY = 86_400;
const W = 260, H = 64, PAD = 2;

function fmt(n: number, money?: boolean): string {
  if (money) { const d = n / 100, a = Math.abs(d); return `${d < 0 ? "−" : ""}$${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0)}`; }
  const a = Math.abs(n);
  return `${n < 0 ? "−" : ""}${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(0)}k` : a.toLocaleString()}`;
}

export function Multiples({ panels, from, fork, cumulative, until, polls, names }: { panels: Panel[]; from: number; fork: number; cumulative: boolean; until: number; polls: number[]; names: [string, string] }) {
  let group: string | undefined;
  const out: ReactElement[] = [];
  for (const p of panels) {
    if (p.group !== group) { group = p.group; if (group) out.push(<div key={`g:${group}`} className="cp-group">{group}</div>); }
    out.push(<Card key={p.id} p={p} from={from} fork={fork} cumulative={cumulative} until={until} polls={polls} names={names} />);
  }
  return (
    <>
      <p className="cp-legend">Each line is labelled at its end. The dashed line is where the two runs split; the blue line is election day.</p>
      <div className="cp-grid">{out}</div>
    </>
  );
}

function Card({ p, from, fork, cumulative, until, polls, names }: { p: Panel; from: number; fork: number; cumulative: boolean; until: number; polls: number[]; names: [string, string] }) {
  const t = useLens((s) => s.t), setT = useLens((s) => s.setT);
  const [hover, setHover] = useState<number | null>(null);
  const { a, b, n, lo, hi } = useMemo(() => {
    const n = Math.min(until, Math.max(p.a.length, p.b.length)) - from;
    const shape = (xs: number[]) => { const out: number[] = []; let run = 0; for (let i = 0; i < n; i++) { const v = xs[from + i] ?? 0; if (cumulative) { if (from + i >= fork) run += v; out.push(from + i >= fork ? run : 0); } else out.push(v); } return out; };
    const a = shape(p.a), b = shape(p.b);
    const all = [...a, ...b];
    return { a, b, n, lo: Math.min(0, ...all), hi: Math.max(1, ...all) };
  }, [p, from, fork, cumulative, until]);
  if (n <= 1) return null;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - 2 * PAD);
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const total = (xs: number[]) => xs.slice(fork, until).reduce((s, v) => s + v, 0);
  const ta = total(p.a), tb = total(p.b), d = ta - tb;
  const at = hover ?? Math.max(0, Math.min(n - 1, Math.floor(t / DAY) - from));
  const cursor = Math.floor(t / DAY) - from;
  return (
    <div className="cp-card" title={p.note}>
      <div className="cp-card-head"><span className="t">{p.title}</span><span className="d">{d === 0 ? "same" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d), p.money)}`}</span></div>
      <div className="cp-spark-box">
      <span className="cp-end a" style={{ top: `${(y(a[n - 1] ?? 0) / H) * 100}%` }}>{names[0]}</span>
      <span className="cp-end b" style={{ top: `${(y(b[n - 1] ?? 0) / H) * 100}%`, ...(Math.abs(y(a[n - 1] ?? 0) - y(b[n - 1] ?? 0)) < 9 ? { transform: "translateY(4px)" } : {}) }}>{names[1]}</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="cp-spark"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); }}
        onMouseLeave={() => setHover(null)} onClick={() => hover !== null && setT((from + hover) * DAY)}>
        <rect x={0} y={0} width={x(Math.max(0, fork - from))} height={H} className="pre" />
        {lo < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="zero" />}
        <line x1={x(fork - from)} x2={x(fork - from)} y1={0} y2={H} className="fork" />
        {[...new Set(polls.map((q) => Math.floor(q / DAY)))].filter((d) => d - from >= 0 && d - from < n).map((d) => <line key={d} x1={x(d - from)} x2={x(d - from)} y1={0} y2={H} className="poll" />)}
        <path d={path(b)} className="lb" />
        <path d={path(a)} className="la" />
        {cursor >= 0 && cursor < n && <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} className="cur" />}
        {hover !== null && <><circle cx={x(hover)} cy={y(a[hover]!)} r={2.5} className="da" /><circle cx={x(hover)} cy={y(b[hover]!)} r={2.5} className="db" /></>}
      </svg>
      </div>
      <div className="cp-card-foot">
        <span className="st-faint">day {worldDay((from + at) * DAY)}{cumulative ? ", so far" : ""}</span>
        <span className="a">{fmt(a[at] ?? 0, p.money)}</span><span className="b">{fmt(b[at] ?? 0, p.money)}</span>
      </div>
      <div className="cp-card-tot st-faint">After the split: {names[0]} {fmt(ta, p.money)}, {names[1]} {fmt(tb, p.money)}.</div>
    </div>
  );
}
