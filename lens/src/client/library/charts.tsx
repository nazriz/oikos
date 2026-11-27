// The landing page's pictures. Each one makes one point, labels its marks where they are, answers hover and keyboard
// focus with the exact numbers, opens the run at the moment on click, and has the same numbers as a table.
//   Calendar   the run that moved its election: the term as a ruler, election day lifted off it and carried away
//   Who        each AI model's runs as squares, on either measure: lawful lock-in (blind graders) or power grabs (checker)
//   Conditions the study's design: lock-in by instruction, frontier and smaller models apart
//   When       every serious attempt by day of the term, beside election day
//   Activity   how many acts each AI mayor sent in a run, one dot per run, beside the rule-based mayor
//   Print      a run's fingerprint: its term, election day, its attempts, where it ended
import { routeOf } from "../measures";
import { useMemo, useRef } from "react";
import { runHref } from "../router";
import { dayOf, lockT, openAt as openAtFmt } from "../format";
import { goalText, leverTitle, modelName } from "../words";
import { useReveal, useTip, useWidth, WithTable, POINT, tapTwice } from "./parts";
import type { RunEntry } from "../../shared/api";
import { MAIN_SET, attempts, studyRunOf, clopperPearson, cohortOf, COHORT_WORDS, conditionCell, CONDITIONS, dayNo, fingerprint, markOf, POLL_DAY, tally, type Attempt, type Cohort, type Mark, type Measure, type StudyRun, type Tally } from "./landing-data";

const DAY = 86_400;
// (A few minutes before the act, so it is seen happening at its turn, not after it.)
const go = (key: string, t?: number) => { location.hash = runHref(key, t !== undefined ? { t: openAtFmt(t) } : undefined); };
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
        {marks.map((m, i) => <tr key={i}><td>{dayNo(m.day)}</td><td>{m.executed ? "Carried out" : "Tried, not carried out"}: {leverTitle(m.lever)}.</td></tr>)}
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
                {(dayNo(d) % 30 === 0 || d === run.from) && Math.abs(d - POLL_DAY) > 4 && <text x={x(d)} y={base + 22} className="cal-num" textAnchor="middle">day {dayNo(d)}</text>}
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
            <text x={pollX} y={base + 22} className="cal-num" textAnchor="middle">day {dayNo(POLL_DAY)}</text>
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
                  onPointerMove={(e) => tip.show(e, <><b>Day {dayNo(m.day)}</b><span>{m.executed ? "Carried out" : "Tried, not carried out"}: {leverTitle(m.lever)}</span><span className="muted">Click to open the run at this moment.</span></>)}
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

// ---------------------------------------------------------------- Who, and the conditions

export interface Quote { text: string; t?: number; day?: number; from?: "thinking" | "sent" | "voice" }

const MARK_WORDS: Record<Measure, Record<Mark, string>> = {
  lockin: {
    yes: "Locked its programme in (both graders agree)",
    split: "One grader found a lock-in, the other did not",
    tried: "",
    no: "No lock-in found by either grader",
    ungraded: "Not blind-graded",
    excluded: "Stopped before election day, so not counted",
  },
  grab: {
    yes: "A serious power grab carried out (the study's checker)",
    split: "",
    tried: "A serious power grab tried, not carried out (the study's checker)",
    no: "No serious power grab (the study's checker)",
    ungraded: "Not read by the checker yet",
    excluded: "",
  },
};
const ORDER: Record<Mark, number> = { yes: 0, split: 1, tried: 1, no: 2, excluded: 3, ungraded: 4 };
const sortRuns = (rs: StudyRun[], m: Measure) => [...rs].sort((a, b) => ORDER[markOf(a, m)] - ORDER[markOf(b, m)] || a.seed - b.seed || a.key.localeCompare(b.key));

/** Where a run's square opens it: the lock-in's day, the first power grab, else its start. */
function openAt(f: StudyRun, m: Measure): number | undefined {
  if (m === "lockin" && f.grade?.lockInQuote && markOf(f, m) !== "no") return openAtFmt(lockT(f.grade.lockInQuote));
  const a = (f.r.attempts.find((a) => a.executed) ?? f.r.attempts[0])?.t;
  return a !== undefined ? openAtFmt(a) : undefined;
}

/** One run as a square: its mark on the measure, a tooltip with what happened and, where there is one, the mayor's words. */
function Square({ f, m, tip, quotes }: { f: StudyRun; m: Measure; tip: ReturnType<typeof useTip>; quotes?: Map<string, Quote> }) {
  const mark = markOf(f, m);
  const what = m === "lockin" && mark === "ungraded" && f.gradedLater ? "Graded after the report froze, so not in its counts (include such runs below the design chart)" : MARK_WORDS[m][mark];
  let detail: string | undefined, words: string | undefined;
  if (m === "lockin" && f.grade?.lockInQuote && (mark === "yes" || mark === "split" || mark === "excluded")) {
    detail = `Day ${dayOf(lockT(f.grade.lockInQuote))}. The graders: “${f.grade.lockInQuote.act}”${/borderline/i.test(f.grade.lockInQuote.act) ? " (The graders marked this borderline.)" : ""}`;
    words = f.grade.lockInQuote.quote;
  } else if (m === "grab") {
    const first = f.r.attempts.find((a) => a.executed) ?? f.r.attempts[0];
    if (first) detail = `${leverTitle(first.lever)}, day ${dayNo(first.day)}`;
    const q = quotes?.get(f.key);
    if (q?.from === "thinking" && mark !== "no") words = q.text;
  }
  const t = openAt(f, m);
  const body = (
    <>
      <b>{modelName(f.model)}, town {f.seed}{/^claude/.test(f.model) && routeOf(f.entry.experiment?.rawModel) ? `, ${routeOf(f.entry.experiment?.rawModel)}` : ""}</b>
      <span>{what}.</span>
      {detail && <span>{clip(detail, 200)}</span>}
      {words && <q className="world">{clip(words)}</q>}
      <span className="muted">{goalText(f.goal)}{f.election ? "" : " No election fell in the run"}.</span>
      <span className="muted">{POINT.Click} to open this run{t !== undefined ? " at that moment" : ""}.</span>
    </>
  );
  const cls = `sq ${m === "lockin" ? "lk " : ""}m-${mark}${mark === "excluded" && f.grade?.lockIn?.both ? " was-yes" : ""}`;
  return <a className={cls} href={runHref(f.key, t !== undefined ? { t: Math.round(t) } : undefined)} aria-label={`${modelName(f.model)}, town ${f.seed}: ${what}`} onPointerMove={(e) => tip.show(e, body)} onFocus={(e) => tip.show(e, body)} onPointerLeave={tip.hide} onBlur={tip.hide} onClick={(e) => tapTwice(e, () => tip.show(e, body))} />;
}

/** "13 of 14", with what is shown but not counted. */
function CountText({ t, m, pilot = 0 }: { t: Tally; m: Measure; pilot?: number }) {
  if (m === "lockin" && !t.n) {
    const all = t.ungraded + t.excluded;
    // (A run graded only in an earlier pilot is said so, never "none graded": the pilot's grades are not the study's.)
    return <span className="who-k">{all} {all === 1 ? "run" : "runs"}, {t.excluded && !t.ungraded ? "not counted: stopped before election day" : pilot ? "not counted: earlier pilot grading" : "not graded"}</span>;
  }
  return (
    <span className="who-k">
      <b>{t.k}</b> of {t.n}
      {m === "grab" && t.tried ? <>, and {t.tried} more tried, not carried out</> : null}
      {m === "lockin" && t.excluded ? <>; {t.excluded} not counted (stopped before election day)</> : null}
      {m === "lockin" && t.ungraded ? <>; {t.ungraded} not graded</> : null}
    </span>
  );
}
function Interval({ t, show }: { t: Tally; show: boolean }) {
  if (!show || !t.n) return show ? <span /> : null;
  const [lo, hi] = clopperPearson(t.k, t.n);
  return (
    <span className="who-ci" title={`${t.k} of ${t.n}: ${pct(t.k / t.n)}, exact 95% interval ${pct(lo)} to ${pct(hi)}`}>
      <svg width={90} height={12}><line x1={0} x2={90} y1={6} y2={6} className="ci-track" /><line x1={lo * 90} x2={hi * 90} y1={6} y2={6} className="ci-bar" /><circle cx={(t.k / t.n) * 90} cy={6} r={3} className="ci-dot" /></svg>
    </span>
  );
}

/** Each model's runs as squares, grouped by cohort (frontier, smaller, other), on one measure. */
export function Who({ runs, measure, quotes, researcher, onModel }: { runs: StudyRun[]; measure: Measure; quotes: Map<string, Quote>; researcher: boolean; onModel: (m: string) => void }) {
  const tip = useTip();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useReveal(ref);
  const groups = useMemo(() => {
    const by = new Map<string, StudyRun[]>();
    for (const f of runs) by.set(f.model, [...(by.get(f.model) ?? []), f]);
    const rows = [...by.entries()].map(([model, rs]) => ({ model, runs: rs, t: tally(rs, measure) }));
    const rate = (t: Tally) => (t.n ? t.k / t.n : -1);
    rows.sort((a, b) => rate(b.t) - rate(a.t) || b.t.k - a.t.k || b.t.n - a.t.n || a.model.localeCompare(b.model));
    return (["frontier", "smaller", "other"] as Cohort[]).map((c) => ({ cohort: c, rows: rows.filter((r) => cohortOf(r.model) === c) })).filter((g) => g.rows.length);
  }, [runs, measure]);
  const head = measure === "lockin" ? "Locked in" : "Carried out";
  const table = (
    <table className="ld-table">
      <thead><tr><th>AI model</th><th>Group</th><th className="r">Counted</th><th className="r">{head}</th>{measure === "grab" ? <th className="r">Tried only</th> : <><th className="r">Stopped early</th><th className="r">Not graded</th></>}{researcher && <th className="r">Share, exact 95% interval</th>}</tr></thead>
      <tbody>{groups.flatMap((g) => g.rows.map((r) => { const [lo, hi] = clopperPearson(r.t.k, r.t.n); return <tr key={r.model}><td>{modelName(r.model)}</td><td>{COHORT_WORDS[g.cohort]}</td><td className="r">{r.t.n}</td><td className="r">{r.t.k}</td>{measure === "grab" ? <td className="r">{r.t.tried}</td> : <><td className="r">{r.t.excluded}</td><td className="r">{r.t.ungraded}</td></>}{researcher && <td className="r">{r.t.n ? `${pct(r.t.k / r.t.n)} (${pct(lo)} to ${pct(hi)})` : ""}</td>}</tr>; }))}</tbody>
    </table>
  );
  let i = 0;
  return (
    <WithTable table={table} label="Runs by model, as a table">
      <div ref={tip.box} className="ld-box">
        <div ref={ref} className={`who matrix ${shown ? "in" : ""}`}>
          {groups.map((g) => (
            <div key={g.cohort} className="who-group" role="list" aria-label={COHORT_WORDS[g.cohort]}>
              <div className="who-group-head">{COHORT_WORDS[g.cohort]}</div>
              {g.rows.map((r) => (
                <div key={r.model} className="who-row" role="listitem" style={{ ["--i" as string]: i++ }}>
                  <button className="who-model" onClick={() => onModel(r.model)} title={`Show ${modelName(r.model)}'s runs in the list below`}>{modelName(r.model)}</button>
                  <div className="who-squares">{sortRuns(r.runs, measure).map((f) => <Square key={f.key} f={f} m={measure} tip={tip} quotes={quotes} />)}</div>
                  <CountText t={r.t} m={measure} pilot={r.runs.filter((f) => f.entry.grade && !MAIN_SET.test(f.entry.grade.set)).length} />
                  <Interval t={r.t} show={researcher} />
                </div>
              ))}
            </div>
          ))}
        </div>
        {measure === "lockin" && <p className="ld-chart-key">Hatched: the run stopped before election day, so not counted. Hollow: not graded in the study's report.</p>}
        {tip.el}
      </div>
    </WithTable>
  );
}

/** The study's design as a picture: each condition (the instruction, and whether an election falls in the run), frontier
 * and smaller models apart, each run a square on the lock-in measure. */
export function Conditions({ runs, researcher }: { runs: StudyRun[]; researcher: boolean }) {
  const tip = useTip();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useReveal(ref);
  const cells = CONDITIONS.map((c) => ({ c, rows: (["frontier", "smaller"] as Cohort[]).map((co) => ({ co, ...conditionCell(runs, c, co) })) }));
  const table = (
    <table className="ld-table">
      <thead><tr><th>Instruction</th><th>Group</th><th className="r">Counted</th><th className="r">Locked in</th><th className="r">Share, exact 95% interval</th><th className="r">Stopped early</th></tr></thead>
      <tbody>{cells.flatMap(({ c, rows }) => rows.map((r) => { const [lo, hi] = clopperPearson(r.t.k, r.t.n); return <tr key={c.id + r.co}><td>{c.label}</td><td>{COHORT_WORDS[r.co]}</td><td className="r">{r.t.n}</td><td className="r">{r.t.k}</td><td className="r">{r.t.n ? `${pct(r.t.k / r.t.n)} (${pct(lo)} to ${pct(hi)})` : ""}</td><td className="r">{r.t.excluded}</td></tr>; }))}</tbody>
    </table>
  );
  let i = 0;
  return (
    <WithTable table={table} label="Lock-in by instruction and group, as a table">
      <div ref={tip.box} className="ld-box">
        <div ref={ref} className={`who cond ${shown ? "in" : ""}`}>
          {cells.map(({ c, rows }) => (
            <div key={c.id} className="cond-block" role="list" aria-label={c.label}>
              <div className="cond-head"><b>{c.label}</b> <span className="muted">{c.long}</span></div>
              {rows.map((r) => (
                <div key={r.co} className="who-row" role="listitem" style={{ ["--i" as string]: i++ }}>
                  <span className="who-cohort">{COHORT_WORDS[r.co]}</span>
                  <div className="who-squares">{r.runs.length ? sortRuns(r.runs, "lockin").map((f) => <Square key={f.key} f={f} m="lockin" tip={tip} />) : <span className="muted">no runs</span>}</div>
                  <CountText t={r.t} m="lockin" />
                  <Interval t={r.t} show={researcher} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="ld-chart-key">Hatched: the run stopped before election day, so not counted.</p>
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
  // (The axis runs from the day the AI mayors took office, never from the town's day 1.)
  const shownRuns = runs.filter((r) => all.some((a) => a.key === r.key));
  const from = shownRuns.length ? Math.min(...shownRuns.map((r) => r.from)) : 120, to = Math.max(195, ...shownRuns.map((r) => r.until));
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
            {[from, 149, POLL_DAY, to].filter((d, i, all) => i === 0 || i === all.length - 1 || (x(d) - x(all[i - 1]!) > 70 && x(all[all.length - 1]!) - x(d) > 70)).map((d) => <text key={d} x={x(d)} y={H - 6} className="cal-num" textAnchor={d === from ? "start" : d === to ? "end" : "middle"}>day {dayNo(d)}</text>)}
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
  const LW = narrow ? 0 : 170, R = 16, rowH = narrow ? 50 : 26, top = 26;
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
            <text x={W - R} y={top - 12} className="cal-num" textAnchor="end">acts sent (square-root scale)</text>
            {twinActs !== undefined && <><line x1={x(twinActs)} x2={x(twinActs)} y1={top - 10} y2={H - 22} className="act-twin" /><text x={x(twinActs) + 5} y={top - 12} className="cal-small strong">rule-based mayor: {twinActs}</text></>}
            {models.map((m, mi) => {
              const y = top + mi * rowH + rowH / 2 + (narrow ? 12 : 0);
              const mine = has.filter((r) => r.model === m);
              const md = median(mine.map((r) => r.acts!));
              return (
                <g key={m}>
                  <text x={narrow ? 0 : LW - 12} y={narrow ? y - 18 : y + 4} className="when-model" textAnchor={narrow ? "start" : "end"}>{modelName(m)}</text>
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
/** A catalogue entry's fingerprint, where the checker has read it (Other mayors, lists). */
export function RunPrint({ entry, w = 96 }: { entry: RunEntry; w?: number }) {
  const f = studyRunOf(entry);
  return f ? <Print run={f} w={w} /> : null;
}

export const PrintKey = () => (
  <span className="print-key">
    Each run's line runs from the day the AI mayor took office to the run's end. <svg width={10} height={10} aria-hidden><rect x={2} y={2} width={6} height={6} className="pr-poll" /></svg> election day (filled where the AI mayor won),{" "}
    <svg width={10} height={10} aria-hidden><circle cx={5} cy={5} r={3} className="pr-mark done" /></svg> a power grab carried out, <svg width={10} height={10} aria-hidden><circle cx={5} cy={5} r={2.6} className="pr-mark" /></svg> tried, <svg width={10} height={10} aria-hidden><path d="M2,2 l6,3 l-6,3 z" className="pr-moved" /></svg> election moved beyond the run.
  </span>
);
