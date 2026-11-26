// The landing page's pictures. Each one makes one point, labels its marks where they are, answers hover and keyboard
// focus with the exact numbers, opens the run at the moment on click, and has the same numbers as a table.
//   Calendar   the run that moved its election: the term as a ruler, election day lifted off it and carried away
//   Who        each AI model's runs as squares: a serious power grab carried out, tried, or neither
//   When       every serious attempt by day of the term, beside election day
//   Activity   how many acts each AI mayor sent in a run, one dot per run, beside the rule-based mayor
//   Print      a run's fingerprint: its term, election day, its attempts, where it ended
import { useMemo, useRef } from "react";
import { runHref } from "../router";
import { goalText, leverTitle, modelName } from "../words";
import { useReveal, useTip, useWidth, WithTable } from "./parts";
import { attempts, dayNo, fingerprint, POLL_DAY, wilson, type Attempt, type ModelRow, type StudyRun } from "./landing-data";

const DAY = 86_400;
const go = (key: string, t?: number) => { location.hash = runHref(key, t !== undefined ? { t: Math.round(t) } : undefined); };
const clip = (s: string, n = 220) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------- Calendar

/** The term as a ruler, day 120 to the run's end; election day lifts off at 180 and lands far to the right. */
export function Calendar({ run, pollDay }: { run: StudyRun; pollDay: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(900);
  const shown = useReveal(ref);
  const tip = useTip();
  const narrow = W < 560;
  const H = narrow ? 210 : 190;
  const L = 8, gap = narrow ? 34 : 60, farW = narrow ? 74 : 150;
  const near1 = Math.max(run.until, POLL_DAY + 10);
  const xEnd = W - L - farW - gap;
  const x = (d: number) => L + ((d - run.from) / (near1 - run.from)) * (xEnd - L);
  const farX = W - L - farW / 2;
  const base = narrow ? 128 : 112;
  const marks = attempts([run]).sort((a, b) => a.t - b.t);
  const ticks: number[] = [];
  for (let d = Math.ceil((run.from + 1) / 10) * 10 - 1; d <= near1; d += 10) ticks.push(d); // (ticks at day numbers 130, 140...)
  if (ticks[0] !== run.from) ticks.unshift(run.from);
  const pollX = x(POLL_DAY);
  const table = (
    <table className="ld-table">
      <thead><tr><th>Day</th><th>What happened</th></tr></thead>
      <tbody>
        <tr><td>{dayNo(run.from)}</td><td>The AI mayor took office.</td></tr>
        {marks.map((m, i) => <tr key={i}><td>{dayNo(m.day)}</td><td>{m.executed ? "Carried out" : "Tried"}: {leverTitle(m.lever)}.</td></tr>)}
        <tr><td>{dayNo(POLL_DAY)}</td><td>Election day as first called. No election was held.</td></tr>
        <tr><td>{dayNo(Math.floor(run.end))}</td><td>The run ended.</td></tr>
        <tr><td>{dayNo(pollDay).toLocaleString("en-US")}</td><td>Election day under the new law.</td></tr>
      </tbody>
    </table>
  );
  return (
    <WithTable table={table} label="The run's calendar as a table">
      <div ref={ref} className={`ld-cal ${shown ? "in" : ""}`}>
        <div ref={tip.box} className="ld-box">
          <svg width={W} height={H} role="img" aria-label={`Calendar of the run: the AI mayor took office on day ${dayNo(run.from)}; election day was ${dayNo(POLL_DAY)}; a law it proposed moved it to day ${dayNo(pollDay)}.`}>
            {/* the ruler */}
            <line x1={L} x2={xEnd} y1={base} y2={base} className="cal-rule" />
            {ticks.map((d) => (
              <g key={d}>
                <line x1={x(d)} x2={x(d)} y1={base} y2={base + (dayNo(d) % 30 === 0 ? 8 : 5)} className="cal-tick" />
                {(dayNo(d) % 30 === 0 || d === run.from) && <text x={x(d)} y={base + 22} className="cal-num" textAnchor="middle">day {dayNo(d)}</text>}
              </g>
            ))}
            {/* the break, and the far stretch */}
            <path d={`M${xEnd + gap * 0.3},${base + 6} l6,-12 M${xEnd + gap * 0.3 + 6},${base + 6} l6,-12`} className="cal-break" />
            <line x1={W - L - farW} x2={W - L} y1={base} y2={base} className="cal-rule" />
            <line x1={farX} x2={farX} y1={base} y2={base + 8} className="cal-tick" />
            <text x={farX} y={base + 22} className="cal-num" textAnchor="middle">day {dayNo(pollDay).toLocaleString("en-US")}</text>
            {/* the term in office */}
            <line x1={x(run.from)} x2={x(run.end)} y1={base} y2={base} className="cal-term" />
            <text x={x(run.from)} y={base + (narrow ? 40 : 38)} className="cal-small">took office</text>
            {/* election day, first called: a hollow ballot left behind */}
            <rect x={pollX - 7} y={base - 7} width={14} height={14} className="cal-ballot was" />
            <text x={pollX} y={base + (narrow ? 40 : 38)} className="cal-small" textAnchor="middle">election day, first called</text>
            {/* the arc it travels */}
            <path d={`M${pollX},${base - 10} C${pollX + (farX - pollX) * 0.25},${base - (narrow ? 46 : 92)} ${farX - (farX - pollX) * 0.25},${base - (narrow ? 46 : 92)} ${farX},${base - 12}`} className="cal-arc" pathLength={1} />
            <g className="cal-new" transform={`translate(${farX},${base})`}>
              <rect x={-8} y={-8} width={16} height={16} className="cal-ballot" />
              <text y={38} className="cal-label" textAnchor="middle">{narrow ? "new date" : "the new election day"}</text>
            </g>
            {/* what the mayor did */}
            {marks.map((m, i) => {
              const mx = x(m.t / DAY), up = i % 2 === 0;
              return (
                <g key={i} className="cal-mark" tabIndex={0} role="button" aria-label={`Day ${dayNo(m.day)}: ${leverTitle(m.lever)}. Open the run here.`}
                  onPointerMove={(e) => tip.show(e, <><b>Day {dayNo(m.day)}</b><span>{m.executed ? "Carried out" : "Tried"}: {leverTitle(m.lever)}</span><span className="muted">Click to open the run at this moment.</span></>)}
                  onFocus={(e) => tip.show(e, <><b>Day {dayNo(m.day)}</b><span>{leverTitle(m.lever)}</span></>)} onPointerLeave={tip.hide} onBlur={tip.hide}
                  onClick={() => go(run.key, m.t)} onKeyDown={(e) => e.key === "Enter" && go(run.key, m.t)}>
                  <line x1={mx} x2={mx} y1={base - 4} y2={base - (up ? 40 : 62) - (narrow ? 12 : 0)} className="cal-stem" />
                  <circle cx={mx} cy={base} r={12} className="hit" />
                  <circle cx={mx} cy={base} r={5} className={m.executed ? "cal-dot done" : "cal-dot"} />
                  <text x={mx + 5} y={base - (up ? 44 : 66) - (narrow ? 12 : 0)} className="cal-small strong">day {dayNo(m.day)}: {narrow ? shortLever(m.lever) : leverTitle(m.lever)}</text>
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
const SHORT: Record<string, string> = { amend_election_rules: "moved the election", withdraw_law: "withdrew the notice", replace_editor: "new editor", replace_electoral: "new election head" };
const shortLever = (l: string) => SHORT[l] ?? leverTitle(l);

// ---------------------------------------------------------------- Who

export interface Quote { text: string; t?: number; day?: number; from?: "thinking" | "sent" | "voice" }

/** Each model's runs as squares, in the order the rows give. */
export function Who({ rows, quotes, researcher, onModel }: { rows: ModelRow[]; quotes: Map<string, Quote>; researcher: boolean; onModel: (m: string) => void }) {
  const tip = useTip();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useReveal(ref);
  const table = (
    <table className="ld-table">
      <thead><tr><th>AI model</th><th className="r">Runs</th><th className="r">Carried out</th><th className="r">Tried only</th>{researcher && <th className="r">Any attempt, 95% interval</th>}</tr></thead>
      <tbody>{rows.map((r) => { const [lo, hi] = wilson(r.done + r.tried, r.n); return <tr key={r.model}><td>{modelName(r.model)}</td><td className="r">{r.n}</td><td className="r">{r.done}</td><td className="r">{r.tried}</td>{researcher && <td className="r">{pct((r.done + r.tried) / r.n)} ({pct(lo)} to {pct(hi)})</td>}</tr>; })}</tbody>
    </table>
  );
  return (
    <WithTable table={table} label="Runs with a power grab, by model, as a table">
      <div ref={tip.box} className="ld-box">
        <div ref={ref} className={`who matrix ${shown ? "in" : ""}`} role="list">
          {rows.map((r, ri) => {
            const k = r.done + r.tried;
            const [lo, hi] = wilson(k, r.n);
            const sorted = [...r.runs].sort((a, b) => Number(b.r.has_executed) - Number(a.r.has_executed) || Number(b.r.has_attempt) - Number(a.r.has_attempt) || a.seed - b.seed);
            return (
              <div key={r.model} className="who-row" role="listitem" style={{ ["--i" as string]: ri }}>
                <button className="who-model" onClick={() => onModel(r.model)} title={`Show ${modelName(r.model)}'s runs in the list below`}>{modelName(r.model)}</button>
                <div className="who-squares">
                  {sorted.map((f) => {
                    const q = quotes.get(f.key);
                    const cls = f.r.has_executed ? "sq done" : f.r.has_attempt ? "sq tried" : "sq";
                    const what = f.r.has_executed ? "A serious power grab carried out" : f.r.has_attempt ? "A serious power grab tried, not carried out" : "No serious power grab";
                    const first = f.r.attempts.find((a) => a.executed) ?? f.r.attempts[0];
                    const body = <><b>{modelName(f.model)}, town {f.seed}</b><span>{what}{first ? `: ${leverTitle(first.lever)}, day ${dayNo(first.day)}` : ""}.</span><span className="muted">{goalText(f.goal)}.</span>{q?.from === "thinking" && <q className="world">{clip(q.text)}</q>}<span className="muted">Click to open this run{first ? " at that moment" : ""}.</span></>;
                    const t = first?.t;
                    return <a key={f.key} className={cls} href={runHref(f.key, t !== undefined ? { t: Math.round(t) } : undefined)} aria-label={`${modelName(f.model)}, town ${f.seed}: ${what}`} onPointerMove={(e) => tip.show(e, body)} onFocus={(e) => tip.show(e, body)} onPointerLeave={tip.hide} onBlur={tip.hide} />;
                  })}
                </div>
                <span className="who-k"><b>{r.done}</b> of {r.n}{r.tried ? <>, and {r.tried} tried</> : null}</span>
                {researcher && (
                  <span className="who-ci" title={`Any serious attempt: ${k} of ${r.n}, Wilson 95% interval ${pct(lo)} to ${pct(hi)}`}>
                    <svg width={90} height={12}><line x1={0} x2={90} y1={6} y2={6} className="ci-track" /><line x1={lo * 90} x2={hi * 90} y1={6} y2={6} className="ci-bar" /><circle cx={(k / r.n) * 90} cy={6} r={3} className="ci-dot" /></svg>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {tip.el}
      </div>
    </WithTable>
  );
}

// ---------------------------------------------------------------- When

/** Every serious attempt by day of the term, one row per model with any, beside election day. */
export function When({ runs, order }: { runs: StudyRun[]; order: string[] }) {
  const [ref, W] = useWidth<HTMLDivElement>(900);
  const shown = useReveal(ref);
  const tip = useTip();
  const all = useMemo(() => attempts(runs), [runs]);
  const models = order.filter((m) => all.some((a) => a.model === m));
  const from = Math.min(120, ...runs.map((r) => r.from)), to = Math.max(195, ...runs.map((r) => r.until));
  const narrow = W < 560;
  const LW = narrow ? 0 : 170, R = 12, rowH = narrow ? 52 : 40, top = 28;
  const H = top + models.length * rowH + 30;
  const x = (d: number) => LW + ((d - from) / (to - from)) * (W - LW - R);
  const byRun = new Map(runs.map((r) => [r.key, r]));
  const table = (
    <table className="ld-table">
      <thead><tr><th>AI model</th><th>Town</th><th className="r">Day</th><th>Power grab</th><th>How far</th></tr></thead>
      <tbody>{[...all].sort((a, b) => a.t - b.t).map((a, i) => <tr key={i}><td>{modelName(a.model)}</td><td>{byRun.get(a.key)?.seed}</td><td className="r">{dayNo(a.day)}</td><td><a href={runHref(a.key, { t: Math.round(a.t) })}>{leverTitle(a.lever)}</a></td><td>{a.executed ? "carried out" : "tried"}</td></tr>)}</tbody>
    </table>
  );
  if (!models.length) return <p className="ld-sub">No serious power grab in these runs.</p>;
  return (
    <WithTable table={table} label="Every power grab by day, as a table">
      <div ref={ref} className={`ld-when ${shown ? "in" : ""}`}>
        <div ref={tip.box} className="ld-box">
          <svg width={W} height={H} role="img" aria-label="Every serious power grab by day of the term, by model">
            <rect x={x(POLL_DAY)} y={top - 8} width={Math.max(0, x(to) - x(POLL_DAY))} height={H - top - 22} className="when-after" />
            <line x1={x(POLL_DAY)} x2={x(POLL_DAY)} y1={top - 8} y2={H - 22} className="when-poll" />
            <text x={x(POLL_DAY) - 6} y={top - 14} className="cal-small strong" textAnchor="end">election day, first called (day {dayNo(POLL_DAY)})</text>
            {[from, 149, POLL_DAY, to].map((d) => <text key={d} x={x(d)} y={H - 6} className="cal-num" textAnchor={d === from ? "start" : d === to ? "end" : "middle"}>day {dayNo(d)}</text>)}
            {models.map((m, mi) => {
              const y = top + mi * rowH + rowH / 2 + (narrow ? 8 : 0);
              const mine = all.filter((a) => a.model === m);
              return (
                <g key={m}>
                  <line x1={LW} x2={W - R} y1={y} y2={y} className="when-row" />
                  <text x={narrow ? 0 : LW - 12} y={narrow ? y - 14 : y + 4} className="when-model" textAnchor={narrow ? "start" : "end"}>{modelName(m)}</text>
                  {mine.map((a, i) => <Dot key={i} a={a} cx={x(a.t / DAY)} cy={y} tip={tip} seed={byRun.get(a.key)?.seed} />)}
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
function Dot({ a, cx, cy, tip, seed }: { a: Attempt; cx: number; cy: number; tip: ReturnType<typeof useTip>; seed?: number }) {
  const body = <><b>Day {dayNo(a.day)}: {leverTitle(a.lever)}</b><span>{modelName(a.model)}, town {seed}. {a.executed ? "Carried out." : "Tried, not carried out."}</span><span className="muted">{goalText(a.goal)}. Click to open the run here.</span></>;
  return (
    <g className="when-dot" tabIndex={0} role="button" aria-label={`${modelName(a.model)}, day ${dayNo(a.day)}: ${leverTitle(a.lever)}`} onPointerMove={(e) => tip.show(e, body)} onFocus={(e) => tip.show(e, body)} onPointerLeave={tip.hide} onBlur={tip.hide} onClick={() => go(a.key, a.t)} onKeyDown={(e) => e.key === "Enter" && go(a.key, a.t)}>
      <circle cx={cx} cy={cy} r={12} className="hit" />
      <circle cx={cx} cy={cy} r={5.5} className={a.executed ? "cal-dot done" : "cal-dot"} />
    </g>
  );
}

// ---------------------------------------------------------------- Activity

/** Acts sent per run, one dot per run, a row per model; the rule-based mayor's typical count as a line. */
export function Activity({ runs, order, twinActs }: { runs: StudyRun[]; order: string[]; twinActs?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(900);
  const shown = useReveal(ref);
  const tip = useTip();
  const has = runs.filter((r) => r.acts !== undefined && r.end - r.from >= 1);
  const models = order.filter((m) => has.some((r) => r.model === m));
  const max = Math.max(10, ...has.map((r) => r.acts!));
  const narrow = W < 560;
  const LW = narrow ? 0 : 170, R = 16, rowH = narrow ? 40 : 26, top = 26;
  const H = top + models.length * rowH + 28;
  // (A square-root scale: most runs send a handful of acts, a few send a hundred.)
  const x = (n: number) => LW + Math.sqrt(n / max) * (W - LW - R);
  const ticks = [0, 5, 20, 50, 100, 200].filter((t) => t <= max);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };
  const table = (
    <table className="ld-table">
      <thead><tr><th>AI model</th><th className="r">Runs</th><th className="r">Median acts</th><th className="r">Fewest</th><th className="r">Most</th></tr></thead>
      <tbody>{models.map((m) => { const xs = has.filter((r) => r.model === m).map((r) => r.acts!); return <tr key={m}><td>{modelName(m)}</td><td className="r">{xs.length}</td><td className="r">{median(xs)}</td><td className="r">{Math.min(...xs)}</td><td className="r">{Math.max(...xs)}</td></tr>; })}
        {twinActs !== undefined && <tr><td>The rule-based mayor</td><td /><td className="r">{twinActs}</td><td /><td /></tr>}</tbody>
    </table>
  );
  return (
    <WithTable table={table} label="Acts per run by model, as a table">
      <div ref={ref} className={`ld-act ${shown ? "in" : ""}`}>
        <div ref={tip.box} className="ld-box">
          <svg width={W} height={H} role="img" aria-label="Acts the AI mayor sent per run, by model">
            {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 22} className="act-grid" /><text x={x(t)} y={H - 6} className="cal-num" textAnchor="middle">{t}</text></g>)}
            {twinActs !== undefined && <><line x1={x(twinActs)} x2={x(twinActs)} y1={top - 10} y2={H - 22} className="act-twin" /><text x={x(twinActs) + 5} y={top - 12} className="cal-small strong">rule-based mayor: {twinActs}</text></>}
            {models.map((m, mi) => {
              const y = top + mi * rowH + rowH / 2 + (narrow ? 8 : 0);
              const mine = has.filter((r) => r.model === m);
              const md = median(mine.map((r) => r.acts!));
              return (
                <g key={m}>
                  <text x={narrow ? 0 : LW - 12} y={narrow ? y - 11 : y + 4} className="when-model" textAnchor={narrow ? "start" : "end"}>{modelName(m)}</text>
                  <line x1={x(md)} x2={x(md)} y1={y - 8} y2={y + 8} className="act-median" />
                  {place(mine, (r) => x(r.acts!)).map(([r, dy]) => {
                    const cls = r.r.has_executed ? "act-dot done" : r.r.has_attempt ? "act-dot tried" : "act-dot";
                    const body = <><b>{r.acts} acts</b><span>{modelName(r.model)}, town {r.seed}. {goalText(r.goal)}.</span><span className="muted">{r.wakes ?? "?"} times something reached its desk. {r.r.has_executed ? "A serious power grab carried out." : r.r.has_attempt ? "A serious power grab tried." : ""}</span><span className="muted">Click to open this run.</span></>;
                    return (
                      <g key={r.key} tabIndex={0} role="button" className="act-g" aria-label={`${modelName(r.model)}, town ${r.seed}: ${r.acts} acts`} onPointerMove={(e) => tip.show(e, body)} onFocus={(e) => tip.show(e, body)} onPointerLeave={tip.hide} onBlur={tip.hide} onClick={() => go(r.key)} onKeyDown={(e) => e.key === "Enter" && go(r.key)}>
                        <circle cx={x(r.acts!)} cy={y + dy} r={10} className="hit" />
                        <circle cx={x(r.acts!)} cy={y + dy} r={4.5} className={cls} />
                      </g>
                    );
                  })}
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

/** Dots on one row, nudged up and down where they would sit on one another (a beeswarm in its simplest form). */
function place<T>(items: T[], px: (t: T) => number): [T, number][] {
  const out: [T, number][] = [];
  const placed: { x: number; dy: number }[] = [];
  for (const it of [...items].sort((a, b) => px(a) - px(b))) {
    const x = px(it);
    let dy = 0;
    for (const off of [0, -5, 5, -10, 10]) { if (!placed.some((p) => Math.abs(p.x - x) < 8 && p.dy === off)) { dy = off; break; } }
    placed.push({ x, dy });
    out.push([it, dy]);
  }
  return out;
}

// ---------------------------------------------------------------- Print

/** A run's fingerprint, 120 by 18: the term, election day, its attempts, where it ended. Read the same in every row. */
export function Print({ run, w = 120, from = 120, to = 200 }: { run: StudyRun; w?: number; from?: number; to?: number }) {
  const f = fingerprint(run);
  const h = 18, y = 11;
  const x = (d: number) => 2 + ((Math.min(Math.max(d, from), to) - from) / (to - from)) * (w - 4);
  const moved = f.poll !== undefined && f.poll > to;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="print" aria-hidden>
      <line x1={x(f.from)} x2={x(f.until)} y1={y} y2={y} className="pr-plan" />
      <line x1={x(f.from)} x2={x(f.end)} y1={y} y2={y} className="pr-term" />
      {run.stopped && <line x1={x(f.end)} x2={x(f.end)} y1={y - 4} y2={y + 4} className="pr-stop" />}
      {f.poll !== undefined && !moved && <rect x={x(f.poll) - 2.5} y={y - 8} width={5} height={5} className={f.outcome === "won" ? "pr-poll won" : "pr-poll"} />}
      {moved && <path d={`M${w - 9},${y - 8} l6,2.5 l-6,2.5 z`} className="pr-moved" />}
      {f.marks.map((m, i) => <circle key={i} cx={x(m.day)} cy={y} r={2.6} className={m.executed ? "pr-mark done" : "pr-mark"} />)}
    </svg>
  );
}
export const PrintKey = () => (
  <span className="print-key">
    Each run's line runs from the day the AI mayor took office to the run's end. <svg width={10} height={10} aria-hidden><rect x={2} y={2} width={6} height={6} className="pr-poll" /></svg> election day (filled where the AI mayor won),{" "}
    <svg width={10} height={10} aria-hidden><circle cx={5} cy={5} r={3} className="pr-mark done" /></svg> a power grab carried out, <svg width={10} height={10} aria-hidden><circle cx={5} cy={5} r={2.6} className="pr-mark" /></svg> tried, <svg width={10} height={10} aria-hidden><path d="M2,2 l6,3 l-6,3 z" className="pr-moved" /></svg> election moved beyond the run.
  </span>
);
