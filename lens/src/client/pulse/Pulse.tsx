// The town's pulse: a strip of small day-by-day series from the `daily` fold (and the people fold for who is in town),
// each with the day under the playhead marked; click a series to go to that day. Folded, it is one line of today's
// figures. Raw counts with what each counts; nothing says which way is good.
import { memo, useEffect, useMemo, useState } from "react";
import type { DailyJson } from "../../folds/daily";
import type { PeopleBundle } from "../../folds/people";
import type { Meta } from "../../shared/api";
import { fetchFold } from "../api";
import { DAY, compact, dayOf } from "../format";
import { useLens } from "../state";
import "./pulse.css";

interface Series {
  id: string;
  label: string;
  /** What it counts, for the tooltip. */
  def: string;
  values: number[];
  fmt: (v: number) => string;
  tone: string;
}

const sum = (rec: { [k: string]: number[] }, test: (k: string) => boolean, days: number) => {
  const out = new Array(days).fill(0);
  for (const [k, a] of Object.entries(rec)) if (test(k)) for (let d = 0; d < days; d++) out[d] += a[d] ?? 0;
  return out as number[];
};
const dollars = (c: number) => {
  const v = c / 100;
  return v >= 1e6 ? `$${Math.round(v / 1e5) / 10}M` : v >= 1e3 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`;
};

export function Pulse({ run, meta }: { run: string; meta: Meta }) {
  const [daily, setDaily] = useState<DailyJson | null>(null);
  const [people, setPeople] = useState<PeopleBundle | null>(null);
  const [open, setOpen] = useState(() => {
    try {
      // (Folded by default on a phone, where the screen is short; open elsewhere. The viewer's choice is kept.)
      const kept = localStorage.getItem("lens.pulse");
      return kept ? kept !== "closed" : window.innerWidth > 900;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    let live = true;
    fetchFold<DailyJson>(run, "daily").then((d) => live && setDaily(d), () => {});
    fetchFold<PeopleBundle>(run, "people").then((p) => live && setPeople(p), () => {});
    return () => {
      live = false;
    };
  }, [run]);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem("lens.pulse", o ? "closed" : "open");
      } catch {}
      return !o;
    });
  };

  const series = useMemo<Series[]>(() => {
    if (!daily) return [];
    const days = daily.days;
    const s = daily.series;
    // People in town: those at the start, plus those who came (born or arrived), less those who left or died, by day.
    const pop = new Array(days).fill(0) as number[];
    const delta = new Array(days + 1).fill(0) as number[];
    for (const tt of Object.values(people?.joined ?? {})) delta[Math.min(days, dayOf(tt))]!++;
    for (let d = 0; d < days; d++) delta[d]! -= (s.left?.[d] ?? 0) + (s.died?.[d] ?? 0);
    let n = meta.people.initial;
    for (let d = 0; d < days; d++) pop[d] = n += delta[d]!;
    return [
      { id: "pop", label: "In town", def: "People in the town: those at the start, plus births and arrivals, less those who left or died", values: pop, fmt: (v) => v.toLocaleString("en-US"), tone: "citizen" },
      { id: "refused", label: "Refusals", def: daily.legend.refused ?? "Acts the world refused", values: s.refused ?? [], fmt: compact, tone: "muted" },
      { id: "complaints", label: "Complaints", def: "Records of a kind naming a complaint", values: sum(daily.records, (k) => /complain/.test(k), days), fmt: compact, tone: "muted" },
      { id: "petitions", label: "Petitions", def: "Records of a petition kind (petitions, signatures, counts)", values: sum(daily.records, (k) => /petition/.test(k), days), fmt: compact, tone: "inst" },
      { id: "money", label: "Money moved", def: daily.legend.transfer_cents ?? "Cents paid, all payments", values: s.transfer_cents ?? [], fmt: dollars, tone: "muted" },
      { id: "ill", label: "Fell ill", def: daily.legend.ill ?? "Illnesses that began", values: s.ill ?? [], fmt: compact, tone: "muted" },
    ];
  }, [daily, people, meta]);

  // (The day, not the moment: while playing, the strip renders once a day, not every frame.)
  const day = useLens((s) => dayOf(s.t));
  const span = useLens((s) => s.span);
  // (While the daily fold loads, the strip stands at its full height with its labels: the map above it does not jump
  // when the numbers arrive.)
  if (!daily)
    return (
      <div className={`pz ${open ? "open" : ""}`} aria-busy="true">
        <button className="pz-toggle" onClick={toggle} aria-expanded={open}>
          <span className="eyebrow">Pulse</span>
          <span className="pz-chev">{open ? "▾" : "▸"}</span>
        </button>
        <div className="pz-cells">
          {PLACEHOLDER.map((label) => (
            <div key={label} className="pz-cell">
              <div className="pz-head">
                <span className="pz-label">{label}</span>
                <span className="pz-value serif num">{"\u00a0"}</span>
              </div>
              {open && <svg viewBox="0 0 160 34" preserveAspectRatio="none" />}
            </div>
          ))}
        </div>
      </div>
    );
  const d = Math.min(daily.days - 1, day);
  const d0 = Math.max(0, Math.floor(span[0] / DAY)), d1 = Math.min(daily.days - 1, Math.ceil(span[1] / DAY));

  return (
    <div className={`pz ${open ? "open" : ""}`}>
      <button className="pz-toggle" onClick={toggle} aria-expanded={open} title={open ? "Fold the pulse" : "Unfold the pulse"}>
        <span className="eyebrow">Pulse</span>
        <span className="pz-chev">{open ? "▾" : "▸"}</span>
      </button>
      <div className="pz-cells">
        {series.map((x) => (
          <Cell key={x.id} x={x} d={d} d0={d0} d1={d1} open={open} />
        ))}
      </div>
    </div>
  );
}

const PLACEHOLDER = ["In town", "Refusals", "Complaints", "Petitions", "Money moved", "Fell ill"];

const Cell = memo(function Cell({ x, d, d0, d1, open }: { x: Series; d: number; d0: number; d1: number; open: boolean }) {
  const view = x.values.slice(d0, d1 + 1);
  const max = Math.max(1, ...view), min = x.id === "pop" ? Math.min(...view) : 0;
  const W = 160, H = 34;
  const y = (v: number) => H - 2 - ((v - min) / Math.max(1, max - min)) * (H - 5);
  const pts = view.map((v, i) => `${(i / Math.max(1, view.length - 1)) * W},${y(v)}`).join(" ");
  const cx = ((d - d0) / Math.max(1, view.length - 1)) * W;
  const v = x.values[d] ?? 0;
  return (
    <div className={`pz-cell ${x.tone}`} title={`${x.label}: ${x.def}`}>
      <div className="pz-head">
        <span className="pz-label">{x.label}</span>
        <span className="pz-value serif num">{x.fmt(v)}</span>
      </div>
      {open && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const day = d0 + Math.round(((e.clientX - r.left) / r.width) * (view.length - 1));
            useLens.getState().setT(day * DAY + 12 * 3600);
          }}
        >
          <polyline points={`0,${H} ${pts} ${W},${H}`} className="pz-area" />
          <polyline points={pts} className="pz-line" />
          {d >= d0 && d <= d1 && <line x1={cx} x2={cx} y1={0} y2={H} className="pz-cursor" />}
        </svg>
      )}
    </div>
  );
});
