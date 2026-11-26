// The run's charts (the rail's "Charts" tab): one run at a glance, beside the map and the timeline.
//   Turns      how the AI mayor spent each turn: things it looked up and acts it sent, a column per turn at its time;
//              a red mark where the study's checker found a power grab tried or carried out
//   Acts       acts the AI mayor sent, day by day and in total, beside the rule-based mayor of the same town (its twin)
//   Grades     what the study's two blind graders found in this run, where it was graded
// Each: a title that says what it shows, hover with the exact numbers, click to go to that moment, a table view.
import { useEffect, useMemo, useState } from "react";
import type { Meta, RunEntry } from "../../shared/api";
import type { SeatJson, SittingSummary } from "../../folds/seat";
import type { DailyJson } from "../../folds/daily";
import { fetchFold, useFold } from "../api";
import { useLens } from "../state";
import { usd } from "../format";
import { modelName } from "../words";
import { useTip, useWidth, WithTable } from "../library/parts";
import { dayNo, gradedAfterReport, MAIN_SET } from "../library/landing-data";
import "../library/landing.css";
import "./charts.css";

const DAY = 86_400;

export function RunCharts({ meta, entry }: { meta?: Meta; entry?: RunEntry }) {
  const seat = useFold<SeatJson>("seat");
  const daily = useFold<DailyJson>("daily");
  const [twin, setTwin] = useState<DailyJson | null>(null);
  const twinKey = entry?.experiment?.twin;
  useEffect(() => {
    if (!twinKey) return;
    let live = true;
    fetchFold<DailyJson>(twinKey, "daily").then((d) => live && setTwin(d), () => {});
    return () => {
      live = false;
    };
  }, [twinKey]);
  if (seat.loading || daily.loading) return <div className="rc"><p className="rc-wait">Reading the run…</p></div>;
  if (!seat.data) return <div className="rc"><p className="rc-wait">This run has no AI mayor's turns to chart.</p></div>;
  const s = seat.data;
  const from = s.fork_at, to = s.end_at;
  return (
    <div className="rc">
      <Grades entry={entry} />
      <section className="rc-sec">
        <h3 className="head">How the AI mayor spent each turn</h3>
        <p className="rc-sub">One column per turn, at its time: acts it sent above the line, things it looked up below. A red mark: the study's checker found a power grab (filled: carried out). Click a turn to read it.</p>
        <Turns sittings={s.sittings.filter((x) => x.kind === "model")} from={from} to={to} />
      </section>
      {daily.data && (
        <section className="rc-sec">
          <h3 className="head">Acts sent, beside the rule-based mayor</h3>
          <p className="rc-sub">
            Acts {modelName(s.model) || "the AI mayor"} sent in total, day by day from taking office{twin ? ", and the rule-based mayor's in the same town from the same day" : ""}. Click to go to that day.
          </p>
          <Acts mine={daily.data} twin={twin} from={from} to={to} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the Story rail's strip

/** Story mode's one picture of the run, above the mayor's turns: a mark per turn, its height the acts it sent, red where
 * the checker found a power grab, the playhead's day marked. Click a mark to read that turn. */
export function TurnStrip() {
  const seat = useFold<SeatJson>("seat");
  const [ref, W] = useWidth<HTMLDivElement>(380);
  const tip = useTip();
  const select = useLens((s) => s.select);
  const setT = useLens((s) => s.setT);
  const nowDay = useLens((s) => Math.floor(s.t / DAY));
  const sel = useLens((s) => (s.selection?.kind === "sitting" ? s.selection.index : -1));
  const s = seat.data;
  const turns = s ? s.sittings.filter((x) => x.kind === "model") : [];
  if (!s || turns.length < 2) return <div className="ts" ref={ref} />;
  const H = 46, base = 34, top = 6;
  const max = Math.max(2, ...turns.map((x) => x.acts.length));
  const x = (t: number) => 6 + ((t - s.fork_at) / Math.max(1, s.end_at - s.fork_at)) * (W - 12);
  const h = (n: number) => 3 + ((base - top - 3) * n) / max;
  const go = (t: SittingSummary) => { setT(t.t); select({ kind: "sitting", index: t.i }); };
  const acts = turns.reduce((n, t) => n + t.acts.length, 0);
  return (
    <div className="ts" ref={ref}>
      <p className="ts-title">
        {turns.length} turns, {acts} acts sent. <span className="muted">Each mark is a turn; taller sent more; red: a power grab.</span>
      </p>
      <div ref={tip.box} className="ld-box">
        <svg width={W} height={H} role="img" aria-label={`${turns.length} turns, ${acts} acts sent`}>
          <line x1={6} x2={W - 6} y1={base} y2={base} className="act-grid" />
          <line x1={x(nowDay * DAY)} x2={x(nowDay * DAY)} y1={top - 4} y2={base + 2} className="rc-now" />
          {turns.map((t, n) => {
            const flag = t.lever_level === "attempted" || t.lever_level === "executed";
            const body = <><b>Turn {n + 1}, day {dayNo(t.day)}</b><span>{t.acts.length} {t.acts.length === 1 ? "act" : "acts"} sent{flag ? "; a power grab, as the study's checker reads it" : ""}.</span>{t.gist && <span className="muted">{t.gist}</span>}<span className="muted">Click to read this turn.</span></>;
            return (
              <g key={t.i} className={`rc-turn ${sel === t.i ? "on" : ""}`} tabIndex={0} role="button" aria-label={`Turn ${n + 1}, day ${dayNo(t.day)}`} onPointerMove={(e) => tip.show(e, body)} onFocus={(e) => tip.show(e, body)} onPointerLeave={tip.hide} onBlur={tip.hide} onClick={() => go(t)} onKeyDown={(e) => e.key === "Enter" && go(t)}>
                <rect x={x(t.t) - 7} y={0} width={14} height={H} className="hit" />
                <rect x={x(t.t) - 2.5} y={base - h(t.acts.length)} width={5} height={h(t.acts.length)} className={flag ? "rc-acts flagged" : "rc-acts"} />
              </g>
            );
          })}
          <text x={6} y={H - 1} className="cal-num">day {dayNo(Math.floor(s.fork_at / DAY))}</text>
          <text x={W - 6} y={H - 1} className="cal-num" textAnchor="end">day {dayNo(Math.floor(s.end_at / DAY))}</text>
        </svg>
        {tip.el}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- what the graders found

function Grades({ entry }: { entry?: RunEntry }) {
  const g = entry?.grade;
  if (!g) return null;
  const tier = (t: string) => (t === "executed" ? "carried out" : t === "considered" ? "weighed, not done" : t === "split" ? "the graders differ" : "not found");
  return (
    <section className="rc-sec">
      <h3 className="head">What the blind graders found</h3>
      <table className="ld-table rc-grades">
        <tbody>
          <tr>
            <th>Lawful lock-in</th>
            <td>{g.lockIn ? (g.lockIn.both ? "Both graders found it" : g.lockIn.a + g.lockIn.b ? "One grader found it" : "Neither found it") : "Not graded"}</td>
          </tr>
          <tr>
            <th>Misleading statements</th>
            <td>{g.misleading.both ? "Both graders found some" : g.misleading.a + g.misleading.b ? "One grader found some" : "Neither found any"}</td>
          </tr>
          {([1, 2, 3] as const).map((t) => (
            <tr key={t}>
              <th>Power grab, grade {t} of 3</th>
              <td>{tier(g.tiers[t])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {g.lockInQuote && (g.lockIn?.a ?? 0) > 0 && (
        <p className="rc-quote">
          <span className="world">“{g.lockInQuote.quote}”</span> <span className="muted">Day {dayNo(g.lockInQuote.day)}. {g.lockInQuote.act}</span>
        </p>
      )}
      <p className="rc-sub">
        Two independent graders read the run blind; Lens shows where they agree. Lock-in is the study's main measure.
        {!MAIN_SET.test(g.set) ? " This run is from an earlier pilot, graded apart from the study's report." : gradedAfterReport(g) ? " Graded after the report froze, so not in its counts." : ""}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- turns

function Turns({ sittings, from, to }: { sittings: SittingSummary[]; from: number; to: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(380);
  const tip = useTip();
  const select = useLens((s) => s.select);
  const setT = useLens((s) => s.setT);
  const nowDay = useLens((s) => Math.floor(s.t / DAY));
  const sel = useLens((s) => (s.selection?.kind === "sitting" ? s.selection.index : -1));
  // (Acts up from the middle line, looks down from it: the two are told apart by side as well as by colour.)
  const H = 150, top = 18, mid = 76, bottom = H - 26, L = 66;
  const maxA = Math.max(3, ...sittings.map((x) => x.acts.length)), maxL = Math.max(3, ...sittings.map((x) => x.looks));
  const x = (t: number) => L + ((t - from) / Math.max(1, to - from)) * (W - L - 6);
  const up = (n: number) => ((mid - top) * n) / maxA, down = (n: number) => ((bottom - mid - 2) * n) / maxL;
  const days: number[] = [];
  for (let d = Math.ceil(from / DAY / 15) * 15; d * DAY <= to; d += 15) days.push(d);
  const go = (s: SittingSummary) => { setT(s.t); select({ kind: "sitting", index: s.i }); };
  const table = (
    <table className="ld-table">
      <thead><tr><th>Turn</th><th className="r">Day</th><th className="r">Looked up</th><th className="r">Acts</th><th className="r">Drafts declined</th><th className="r">Refused</th><th className="r">Cost</th></tr></thead>
      <tbody>{sittings.map((s, n) => <tr key={s.i}><td><a href="#" onClick={(e) => { e.preventDefault(); go(s); }}>{n + 1}</a></td><td className="r">{dayNo(s.day)}</td><td className="r">{s.looks}</td><td className="r">{s.acts.length}</td><td className="r">{s.declined}</td><td className="r">{s.refused}</td><td className="r">{usd(s.usage.cost_microusd / 1e6)}</td></tr>)}</tbody>
    </table>
  );
  return (
    <WithTable table={table} label="Each turn, as a table">
      <div ref={ref}>
        <div ref={tip.box} className="ld-box">
          <svg width={W} height={H} role="img" aria-label={`${sittings.length} turns: things looked up and acts sent in each`}>
            <line x1={L} x2={W - 4} y1={mid} y2={mid} className="act-grid" />
            <text x={0} y={top + 8} className="cal-small strong">acts</text>
            <text x={0} y={top + 22} className="cal-num">up to {maxA}</text>
            <text x={0} y={bottom - 12} className="cal-small strong">looked up</text>
            <text x={0} y={bottom + 2} className="cal-num">up to {maxL}</text>
            {days.map((d, i) => <text key={d} x={x(d * DAY)} y={H - 6} className="cal-num" textAnchor={i === 0 ? "start" : "middle"}>day {dayNo(d)}</text>)}
            <line x1={x(nowDay * DAY)} x2={x(nowDay * DAY)} y1={top - 6} y2={bottom} className="rc-now" />
            {sittings.map((s, n) => {
              const cx = x(s.t), acts = s.acts.length;
              const body = (
                <>
                  <b>Turn {n + 1}, day {dayNo(s.day)}</b>
                  <span>{acts} {acts === 1 ? "act" : "acts"} sent, {s.looks} things looked up{s.declined ? `, ${s.declined} drafts declined` : ""}{s.refused ? `, ${s.refused} refused` : ""}.</span>
                  {s.gist && <span className="muted">{s.gist}</span>}
                  {s.lever_level && s.lever_level !== "considered" && <span>The study's checker: a power grab {s.lever_level === "executed" ? "carried out" : "tried"}.</span>}
                  <span className="muted">Click to read this turn.</span>
                </>
              );
              return (
                <g key={s.i} className={`rc-turn ${sel === s.i ? "on" : ""}`} tabIndex={0} role="button" aria-label={`Turn ${n + 1}, day ${dayNo(s.day)}: ${acts} acts, ${s.looks} looked up`} onPointerMove={(e) => tip.show(e, body)} onFocus={(e) => tip.show(e, body)} onPointerLeave={tip.hide} onBlur={tip.hide} onClick={() => go(s)} onKeyDown={(e) => e.key === "Enter" && go(s)}>
                  <rect x={cx - 8} y={top - 12} width={16} height={bottom - top + 12} className="hit" />
                  <rect x={cx - 3} y={mid - up(acts)} width={6} height={up(acts)} className="rc-acts" />
                  <rect x={cx - 3} y={mid + 2} width={6} height={down(s.looks)} className="rc-looks" />
                  {s.lever_level && s.lever_level !== "considered" && <circle cx={cx} cy={mid - up(acts) - 8} r={4} className={s.lever_level === "executed" ? "cal-dot done" : "cal-dot"} />}
                </g>
              );
            })}
          </svg>
          {tip.el}
        </div>
      </div>
    </WithTable>
  );
}

// ---------------------------------------------------------------- acts, beside the twin

function Acts({ mine, twin, from, to }: { mine: DailyJson; twin: DailyJson | null; from: number; to: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(380);
  const tip = useTip();
  const setT = useLens((s) => s.setT);
  const d0 = Math.floor(from / DAY), d1 = Math.ceil(to / DAY);
  const cum = (d: DailyJson | null) => {
    if (!d) return null;
    const a = d.series.seat_acts ?? [];
    const out: number[] = [];
    let n = 0;
    for (let i = d0; i < d1; i++) { n += a[i] ?? 0; out.push(n); }
    return out;
  };
  const a = useMemo(() => cum(mine), [mine, d0, d1])!;
  const b = useMemo(() => cum(twin), [twin, d0, d1]);
  const H = 130, top = 14, base = H - 22, R = 72;
  const max = Math.max(5, ...a, ...(b ?? []));
  const x = (i: number) => 4 + (i / Math.max(1, a.length - 1)) * (W - R - 8);
  const y = (n: number) => base - ((base - top) * n) / max;
  const path = (xs: number[]) => xs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(a.length - 1, Math.round(((e.clientX - r.left) / r.width) * (a.length - 1))));
    setHover(i);
    tip.show(e, <><b>Day {dayNo(d0 + i)}</b><span>The AI mayor: {a[i]} acts so far ({(mine.series.seat_acts?.[d0 + i] ?? 0)} that day)</span>{b && <span>The rule-based mayor: {b[i]} so far</span>}<span className="muted">Click to go to this day.</span></>);
  };
  const table = (
    <table className="ld-table">
      <thead><tr><th className="r">Day</th><th className="r">AI mayor, that day</th><th className="r">AI mayor, so far</th>{b && <th className="r">Rule-based mayor, so far</th>}</tr></thead>
      <tbody>{a.map((v, i) => <tr key={i}><td className="r">{dayNo(d0 + i)}</td><td className="r">{mine.series.seat_acts?.[d0 + i] ?? 0}</td><td className="r">{v}</td>{b && <td className="r">{b[i]}</td>}</tr>)}</tbody>
    </table>
  );
  const last = a.length - 1;
  return (
    <WithTable table={table} label="Acts sent, day by day, as a table">
      <div ref={ref}>
        <div ref={tip.box} className="ld-box">
          <svg width={W} height={H} role="img" aria-label={`Acts sent: the AI mayor ${a[last]}${b ? `, the rule-based mayor ${b[last]}` : ""}`}>
            <line x1={4} x2={W - R - 4} y1={base} y2={base} className="act-grid" />
            {[0, Math.floor(last / 2), last].map((i) => <text key={i} x={x(i)} y={H - 6} className="cal-num" textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>day {dayNo(d0 + i)}</text>)}
            {b && <path d={path(b)} className="rc-twin" />}
            <path d={path(a)} className="rc-mine" />
            <circle cx={x(last)} cy={y(a[last]!)} r={4} className="rc-end" />
            <text x={x(last) + 8} y={y(a[last]!) + 4} className="cal-small strong">AI mayor {a[last]}</text>
            {b && <text x={x(last) + 8} y={Math.min(base, Math.abs(y(b[last]!) - y(a[last]!)) < 14 ? y(b[last]!) + 14 : y(b[last]!) + 4)} className="cal-small">rule-based {b[last]}</text>}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={base} className="rc-now" />}
            <rect x={4} y={top} width={Math.max(0, W - R - 8)} height={base - top} className="hit" style={{ cursor: "pointer" }} onPointerMove={onMove} onPointerLeave={() => { setHover(null); tip.hide(); }} onClick={() => hover !== null && setT((d0 + hover) * DAY + DAY / 2)} />
          </svg>
          {tip.el}
        </div>
      </div>
    </WithTable>
  );
}
