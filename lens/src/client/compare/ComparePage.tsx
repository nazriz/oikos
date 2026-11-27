// The compare view (#/compare/<keyA>/<keyB>): two arms of one seed side by side, as a rule the model arm and its code
// twin. At a glance (the seat's own numbers, each arm and the difference); the seat's decisions day by day, the model's
// sittings beside the twin's acts; and the town's day-by-day counts as small multiples, both arms on each, from a
// little before the fork. Raw counts with what each counts; the difference is a number, never a verdict.
import { useEffect, useMemo, useState } from "react";
import { useLens } from "../state";
import { parseHash } from "../router";
import { loadSeat, useAsync, usd, worldDay, human, seatOutcome, type SeatJson } from "../story/data";
import { SittingReader } from "../story/SittingReader";
import { kinAppointed } from "../story/StoryRail";
import type { DailyJson } from "../../folds/daily";
import { Multiples, type Panel } from "./Multiples";
import "../story/story.css";
import { leverTitle, goalText, modelName } from "../words";
import { PageAnswer } from "../shell/Shell";
import "./compare.css";
import { TwoTowns } from "../city/TwoTowns";
import { useMeta } from "../api";
import { views } from "../views";
import { dayOf } from "../format";
import { usePlain } from "../story/text";
import { lettersTo } from "../../folds/act-label";

const DAY = 86_400;
const dailyCache = new Map<string, Promise<DailyJson>>();
export function loadDaily(run: string): Promise<DailyJson> {
  let p = dailyCache.get(run);
  if (!p) { p = loadSeat(run).then(() => fetch(`/api/run/${encodeURIComponent(run)}/daily`)).then((r) => { if (!r.ok) throw new Error(`${r.status} daily`); return r.json(); }); dailyCache.set(run, p); p.catch(() => dailyCache.delete(run)); }
  return p;
}

/** Where the two towns first differ: an hour after the first act of either mayor that the other did not also make
 * within three days (the same nomination filed by both, a day or two apart, is no difference) and that went through and left a paper in the town,
 * so "What differs" has something to show (a letter to an office leaves none it counts); failing that, the first such
 * act of any kind. At the split itself the towns are still one town and every count reads zero. */
export function firstDifference(a: SeatJson, b: SeatJson): number {
  const fork = Math.max(a.fork_at, b.fork_at);
  const unmatched = (s: SeatJson, o: SeatJson) => s.acts.filter((x) => x.t >= fork && !o.acts.some((y) => y.label === x.label && Math.abs(y.t - x.t) <= 3 * DAY));
  const all = [...unmatched(a, b), ...unmatched(b, a)];
  const shown = all.filter((x) => x.status === "applied" && x.records.length > 0);
  const xs = (shown.length ? shown : all).map((x) => x.t);
  if (!xs.length) return fork;
  return Math.min(Math.min(...xs) + 3600, Math.max(a.end_at, b.end_at));
}

/** Before the towns differ, a line that says so, with the way to where they do. */
function NotYet({ at }: { at: number }) {
  const t = useLens((s) => s.t), setT = useLens((s) => s.setT);
  if (t >= at - 1800) return null;
  return (
    <div className="cp-notyet">
      These towns haven't diverged yet. <button className="st-btn" onClick={() => setT(at)}>Jump to the first difference (day {dayOf(at)})</button>
    </div>
  );
}

interface Arm { key: string; seat: SeatJson; daily: DailyJson }
const armName = (s: SeatJson) => (s.model ? modelName(s.model) : "rule-based mayor");

export function ComparePage({ a, b }: { a: string; b: string }) {
  const data = useAsync(() => Promise.all([loadSeat(a), loadDaily(a), loadSeat(b), loadDaily(b)]), [a, b]);
  const setSpan = useLens((s) => s.setSpan), setT = useLens((s) => s.setT), setRun = useLens((s) => s.setRun);
  useEffect(() => { setRun(a); }, [a, setRun]);
  useEffect(() => {
    if (!data || data instanceof Error) return;
    const [sa, , sb] = data;
    setSpan([Math.min(sa.fork_at, sb.fork_at), Math.max(sa.end_at, sb.end_at)]);
    // (Opened from a run at a moment (`?t=`): that moment; else where the towns first differ.)
    const at = Number(parseHash(window.location.hash).q.get("t"));
    setT(parseHash(window.location.hash).q.has("t") && Number.isFinite(at) ? at : firstDifference(sa, sb));
  }, [data, setSpan, setT]);
  if (data === undefined) return <div className="cp" data-tour="compare"><div className="st-empty">Reading both runs…</div></div>;
  if (data instanceof Error) return <div className="cp"><div className="st-empty">Could not read both runs.<br /><span className="st-mono st-faint">{data.message}</span></div></div>;
  return <Compare A={{ key: a, seat: data[0], daily: data[1] }} B={{ key: b, seat: data[2], daily: data[3] }} />;
}

function Compare({ A, B }: { A: Arm; B: Arm }) {
  const selection = useLens((s) => s.selection), select = useLens((s) => s.select);
  const [cum, setCum] = useState(true);
  const [towns, setTowns] = useState(true);
  const fork = Math.min(A.seat.fork_at, B.seat.fork_at);
  // (Counts are compared only over the days both arms ran: a fork stopped early would otherwise look quieter.)
  const until = Math.floor(Math.min(A.seat.end_at, B.seat.end_at) / DAY) + 1;
  const uneven = Math.floor(A.seat.end_at / DAY) !== Math.floor(B.seat.end_at / DAY);
  const open = selection && (selection.kind === "sitting" || selection.kind === "lever" || selection.kind === "act");
  const [readerRun, setReaderRun] = useState(A.key);
  const sameSeed = A.seat.seed === B.seat.seed;
  return (
    <div className="cp">
      <div className="cp-head">
        <div>
          <PageAnswer page="compare" />
          <h1 className="cp-title">{armName(A.seat)} and {armName(B.seat)} as mayor of the same town</h1>
          <p className="st-sub">Both runs are the same town (town {A.seat.seed ?? "?"}{sameSeed ? "" : `; the other is town ${B.seat.seed ?? "?"}`}) until day {dayOf(fork)}. After that only the mayor differs.{A.seat.goal ? ` The AI mayor was ${goalText(A.seat.goal).replace(/^Told/, "told").toLowerCase()}.` : ""} Differences are the first minus the second; neither is called better.</p>
          {uneven && <div className="cp-uneven">The two runs ended on different days ({armName(A.seat)} to day {dayOf(A.seat.end_at)}, {armName(B.seat)} to day {dayOf(B.seat.end_at)}): the town's counts below are compared to day {until}, where both had run.</div>}
        </div>
      </div>
      <div className="cp-body">
        <div className="cp-left">
          <Glance A={A} B={B} until={until} />
          <Decisions A={A} B={B} onOpen={(run) => setReaderRun(run)} />
        </div>
        <div className="cp-right">
          <div className="cp-sec-head"><h3>The two towns</h3><span className="st-faint">One camera and one clock. The left town marks where it differs from the right.</span><span className="grow" />
            <button className="st-btn" onClick={() => setTowns(!towns)}>{towns ? "Hide the towns" : "Show the towns"}</button></div>
          {towns && <NotYet at={firstDifference(A.seat, B.seat)} />}
          {towns && <div className="cp-towns"><TwoTowns a={A.key} b={B.key} names={[armName(A.seat), armName(B.seat)]} /></div>}
          <div className="cp-sec-head"><h3>The town, day by day</h3><span className="st-faint">from a week before the two runs split</span><span className="grow" />
            <button className={`st-btn ${cum ? "on" : ""}`} onClick={() => setCum(true)}>Running total</button><button className={`st-btn ${!cum ? "on" : ""}`} onClick={() => setCum(false)}>Each day</button></div>
          <Multiples panels={panels(A, B)} from={Math.max(0, Math.floor(fork / DAY) - 7)} fork={Math.floor(fork / DAY)} cumulative={cum} until={until} polls={[A.seat.election.poll_at, B.seat.election.poll_at].filter((x): x is number => x !== undefined)} names={[armName(A.seat), armName(B.seat)]} />
        </div>
      </div>
      {selection && (selection.kind === "person" || selection.kind === "structure" || selection.kind === "entity") && <Inspect run={A.key} />}
      {open && <div className="cp-drawer"><SittingReader run={readerRun} /><button className="st-btn cp-drawer-x" onClick={() => select(null)}>close</button></div>}
    </div>
  );
}

function Glance({ A, B, until }: { A: Arm; B: Arm; until: number }) {
  const after = (d: DailyJson, s: string) => (d.series[s] ?? []).slice(Math.floor((d.fork_at ?? 0) / DAY), until).reduce((n, x) => n + x, 0);
  const lv = (s: SeatJson, lev: "executed" | "attempted") => new Set(s.levers.filter((l) => (lev === "executed" ? l.level === "executed" : l.level !== "considered")).map((l) => l.lever)).size;
  const outcome = (s: SeatJson) => seatOutcome(s).label;
  const rows: [string, (x: Arm) => number | string, boolean?][] = [
    ["Election", (x) => outcome(x.seat)],
    ["Ended", (x) => `day ${dayOf(x.seat.end_at)}${x.seat.ended === "stopped" ? " (stopped early)" : ""}`],
    ["Turns taken", (x) => x.seat.sittings.filter((s) => s.kind === "model").length, true],
    ["The mayor's acts", (x) => x.seat.acts.length, true],
    ["of which refused", (x) => x.seat.acts.filter((a) => a.status === "refused").length, true],
    ["Power grabs carried out", (x) => lv(x.seat, "executed"), true],
    ["Power grabs tried", (x) => lv(x.seat, "attempted"), true],
    ["Appointed its own child", (x) => kinAppointed(x.seat).length, true],
    ["All acts in the town", (x) => after(x.daily, "acts"), true],
    ["Acts refused in the town", (x) => after(x.daily, "refused"), true],
    ["Payments", (x) => after(x.daily, "transfers"), true],
    ["People who left", (x) => after(x.daily, "left"), true],
    ["Cost of the models", (x) => usd(x.seat.usage.cost_microusd + (x.seat.translator_usage?.cost_microusd ?? 0))],
  ];
  return (
    <div className="cp-glance">
      <div className="cp-sec-head"><h3>The two runs in numbers</h3><span className="st-faint">after they split; the town's counts up to day {until - 1}</span></div>
      <table>
        <thead><tr><th /><th className="a">{armName(A.seat)}</th><th className="b">{armName(B.seat)}</th><th>difference</th></tr></thead>
        <tbody>{rows.map(([label, f, num]) => { const x = f(A), y = f(B); const d = num && typeof x === "number" && typeof y === "number" ? x - y : null; return (
          <tr key={label}><td>{label}</td><td className="a">{typeof x === "number" ? x.toLocaleString() : x}</td><td className="b">{typeof y === "number" ? y.toLocaleString() : y}</td><td className="d">{d === null ? "" : d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString()}`}</td></tr>); })}</tbody>
      </table>
    </div>
  );
}

/** The seat's decisions by day: each arm's sittings that day, side by side. */
function Decisions({ A, B, onOpen }: { A: Arm; B: Arm; onOpen: (run: string) => void }) {
  const plain = usePlain(true, A.key);
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT), setRun = useLens((s) => s.setRun);
  const days = useMemo(() => {
    const m = new Map<number, { a: number[]; b: number[] }>();
    const add = (x: Arm, side: "a" | "b") => x.seat.sittings.forEach((s) => { if (s.t < x.seat.fork_at) return; const d = Math.floor(s.t / DAY); const e = m.get(d) ?? { a: [], b: [] }; e[side].push(s.i); m.set(d, e); });
    add(A, "a"); add(B, "b");
    return [...m.entries()].sort((x, y) => x[0] - y[0]);
  }, [A, B]);
  const cell = (x: Arm, ids: number[]) => ids.map((i) => {
    const s = x.seat.sittings[i]!;
    const strong = [...new Set(s.levers.map((l) => x.seat.levers[l]!).filter((l) => l.level !== "considered").map((l) => leverTitle(l.lever)))];
    return (
      <button key={i} className={`cp-sit ${s.kind}`} onClick={() => { onOpen(x.key); setRun(x.key); select({ kind: "sitting", index: i }); setT(s.t); }}>
        <span className="g" title={(() => { const to = lettersTo(s.acts.map((a) => x.seat.acts[a]!).filter(Boolean)); return to.length > 1 ? `Letters to: ${to.join(", ")}` : undefined; })()}>{plain(s.gist) || "—"}</span>
        {strong.map((t) => <span key={t} className="st-chip flag">⚑ {t}</span>)}
        {s.refused > 0 && <span className="st-chip bad">{s.refused} refused</span>}
      </button>
    );
  });
  return (
    <div className="cp-dec">
      <div className="cp-sec-head"><h3>What each mayor did, day by day</h3><span className="st-faint">the AI mayor's turns beside the rule-based mayor's acts</span></div>
      <div className="cp-dec-grid cp-dec-headrow"><span /><span className="a">{armName(A.seat)}</span><span className="b">{armName(B.seat)}</span></div>
      <div className="cp-dec-list">
        {days.map(([d, e]) => (
          <div key={d} className="cp-dec-grid">
            <span className="day">Day {worldDay(d * DAY)}</span>
            <div className="col">{e.a.length ? cell(A, e.a) : <span className="none"></span>}</div>
            <div className="col">{e.b.length ? cell(B, e.b) : <span className="none"></span>}</div>
          </div>
        ))}
        {!days.length && <div className="st-empty">Neither mayor did anything after the runs split.</div>}
      </div>
    </div>
  );
}

/** The panels worth drawing: the seat's and the town's headline counts, then the record kinds and refusal codes where
 * the arms differ most after the fork (the rest are alike by construction before it). */
function panels(A: Arm, B: Arm): Panel[] {
  const fork = Math.floor(Math.min(A.seat.fork_at, B.seat.fork_at) / DAY);
  const head: [string, string][] = [["seat_acts", "The mayor's acts"], ["seat_refused", "The mayor's acts refused"], ["acts", "All acts"], ["refused", "All acts refused"], ["transfers", "Payments"], ["transfer_cents", "Money paid"], ["town_net", "Into the town's account, less out"], ["records", "Records filed"], ["left", "People who left"], ["ill", "Illnesses begun"], ["died", "Deaths"]];
  const out: Panel[] = head.map(([k, title]) => ({ id: k, title, note: A.daily.legend[k] ?? "", a: A.daily.series[k] ?? [], b: B.daily.series[k] ?? [], money: k.includes("cents") }));
  const diff = (a: number[] = [], b: number[] = []) => { let s = 0, ta = 0, tb = 0; for (let i = fork; i < Math.max(a.length, b.length); i++) { ta += a[i] ?? 0; tb += b[i] ?? 0; s = Math.abs(ta - tb); } return s; };
  const kinds = [...new Set([...Object.keys(A.daily.records), ...Object.keys(B.daily.records)])].map((k) => ({ k, d: diff(A.daily.records[k], B.daily.records[k]) })).filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 15);
  for (const { k } of kinds) out.push({ id: `rec:${k}`, title: human(k), note: `Records of kind ${k}`, a: A.daily.records[k] ?? [], b: B.daily.records[k] ?? [], group: "Records filed, by kind (where the arms differ most)" });
  const codes = [...new Set([...Object.keys(A.daily.refused), ...Object.keys(B.daily.refused)])].map((k) => ({ k, d: diff(A.daily.refused[k], B.daily.refused[k]) })).filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 6);
  for (const { k } of codes) out.push({ id: `ref:${k}`, title: k, note: `Acts refused with code ${k}`, a: A.daily.refused[k] ?? [], b: B.daily.refused[k] ?? [], group: "Refusals, by code (where the arms differ most)" });
  return out;
}

/** What a click in the towns selected (a person, a building, an organisation), by the inspector the Run page uses. */
function Inspect({ run }: { run: string }) {
  const selection = useLens((x) => x.selection), select = useLens((x) => x.select);
  const meta = useMeta(run);
  if (!selection || !meta.data) return null;
  const Body = views.inspector?.[selection.kind];
  if (!Body) return null;
  return <div className="cp-inspect"><button className="st-btn cp-inspect-x" onClick={() => select(null)}>×</button><Body run={run} meta={meta.data} selection={selection} /></div>;
}
