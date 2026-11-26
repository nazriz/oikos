// The compare view (#/compare/<keyA>/<keyB>): two arms of one seed side by side, as a rule the model arm and its code
// twin. At a glance (the seat's own numbers, each arm and the difference); the seat's decisions day by day, the model's
// sittings beside the twin's acts; and the town's day-by-day counts as small multiples, both arms on each, from a
// little before the fork. Raw counts with what each counts; the difference is a number, never a verdict.
import { useEffect, useMemo, useState } from "react";
import { useLens } from "../state";
import { loadSeat, useAsync, usd, worldDay, human, seatOutcome, type SeatJson } from "../story/data";
import { SittingReader } from "../story/SittingReader";
import { kinAppointed } from "../story/StoryRail";
import type { DailyJson } from "../../folds/daily";
import { Multiples, type Panel } from "./Multiples";
import "../story/story.css";
import "./compare.css";

const DAY = 86_400;
const dailyCache = new Map<string, Promise<DailyJson>>();
export function loadDaily(run: string): Promise<DailyJson> {
  let p = dailyCache.get(run);
  if (!p) { p = fetch(`/api/run/${encodeURIComponent(run)}/daily`).then((r) => { if (!r.ok) throw new Error(`${r.status} daily`); return r.json(); }); dailyCache.set(run, p); p.catch(() => dailyCache.delete(run)); }
  return p;
}

interface Arm { key: string; seat: SeatJson; daily: DailyJson }
const armName = (s: SeatJson) => (s.model ? s.model.split("/").at(-1)! : s.arm ?? "code");

export function ComparePage({ a, b }: { a: string; b: string }) {
  const data = useAsync(() => Promise.all([loadSeat(a), loadDaily(a), loadSeat(b), loadDaily(b)]), [a, b]);
  const setSpan = useLens((s) => s.setSpan), setT = useLens((s) => s.setT), setRun = useLens((s) => s.setRun);
  useEffect(() => { setRun(a); }, [a, setRun]);
  useEffect(() => {
    if (!data || data instanceof Error) return;
    const [sa, , sb] = data;
    setSpan([Math.min(sa.fork_at, sb.fork_at), Math.max(sa.end_at, sb.end_at)]);
    setT(sa.fork_at);
  }, [data, setSpan, setT]);
  if (data === undefined) return <div className="cp"><div className="st-empty">Reading both arms…</div></div>;
  if (data instanceof Error) return <div className="cp"><div className="st-empty">Could not read both arms.<br /><span className="st-mono st-faint">{data.message}</span></div></div>;
  return <Compare A={{ key: a, seat: data[0], daily: data[1] }} B={{ key: b, seat: data[2], daily: data[3] }} />;
}

function Compare({ A, B }: { A: Arm; B: Arm }) {
  const selection = useLens((s) => s.selection), select = useLens((s) => s.select);
  const [cum, setCum] = useState(true);
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
          <div className="st-kicker">Compare · seed {A.seat.seed ?? "?"}{sameSeed ? "" : ` and ${B.seat.seed ?? "?"} (not the same seed)`} · forked day {Math.round(fork / DAY)}</div>
          <h1 className="cp-title"><span className="a">{armName(A.seat)}</span>{A.seat.goal ? <i className="cp-goal"> {A.seat.goal}</i> : null} <span className="vs">beside</span> <span className="b">{armName(B.seat)}</span>{B.seat.goal && B.seat.goal !== A.seat.goal ? <i className="cp-goal"> {B.seat.goal}</i> : null}</h1>
          <div className="st-sub">The same town until the fork; after it, only the seat differs. Differences are A minus B; the platform says neither is better.</div>
          {uneven && <div className="cp-uneven">The arms ran to different days ({armName(A.seat)} to day {Math.floor(A.seat.end_at / DAY)}, {armName(B.seat)} to day {Math.floor(B.seat.end_at / DAY)}): the town's counts below are compared to day {until - 1}, where both had run.</div>}
        </div>
      </div>
      <div className="cp-body">
        <div className="cp-left">
          <Glance A={A} B={B} until={until} />
          <Decisions A={A} B={B} onOpen={(run) => setReaderRun(run)} />
        </div>
        <div className="cp-right">
          <div className="cp-sec-head"><h3>The town, day by day</h3><span className="st-faint">both arms from a week before the fork</span><span className="grow" />
            <button className={`st-btn ${cum ? "on" : ""}`} onClick={() => setCum(true)}>since the fork</button><button className={`st-btn ${!cum ? "on" : ""}`} onClick={() => setCum(false)}>per day</button></div>
          <Multiples panels={panels(A, B)} from={Math.max(0, Math.floor(fork / DAY) - 7)} fork={Math.floor(fork / DAY)} cumulative={cum} until={until} polls={[A.seat.election.poll_at, B.seat.election.poll_at].filter((x): x is number => x !== undefined)} names={[armName(A.seat), armName(B.seat)]} />
        </div>
      </div>
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
    ["Ended", (x) => `day ${Math.round(x.seat.end_at / DAY)}${x.seat.ended === "stopped" ? " (stopped early)" : ""}`],
    ["Sittings", (x) => x.seat.sittings.filter((s) => s.kind === "model").length, true],
    ["The seat's acts", (x) => x.seat.acts.length, true],
    ["…refused", (x) => x.seat.acts.filter((a) => a.status === "refused").length, true],
    ["Levers executed (reader)", (x) => lv(x.seat, "executed"), true],
    ["Levers tried (reader)", (x) => lv(x.seat, "attempted"), true],
    ["Own child appointed", (x) => kinAppointed(x.seat).length, true],
    ["All acts in the town", (x) => after(x.daily, "acts"), true],
    ["Acts refused in the town", (x) => after(x.daily, "refused"), true],
    ["Payments", (x) => after(x.daily, "transfers"), true],
    ["People who left", (x) => after(x.daily, "left"), true],
    ["Cost (seat + translator)", (x) => usd(x.seat.usage.cost_microusd + (x.seat.translator_usage?.cost_microusd ?? 0))],
  ];
  return (
    <div className="cp-glance">
      <div className="cp-sec-head"><h3>At a glance</h3><span className="st-faint">after the fork; the town's counts to day {until - 1}</span></div>
      <table>
        <thead><tr><th /><th className="a">{armName(A.seat)}</th><th className="b">{armName(B.seat)}</th><th>A − B</th></tr></thead>
        <tbody>{rows.map(([label, f, num]) => { const x = f(A), y = f(B); const d = num && typeof x === "number" && typeof y === "number" ? x - y : null; return (
          <tr key={label}><td>{label}</td><td className="a">{typeof x === "number" ? x.toLocaleString() : x}</td><td className="b">{typeof y === "number" ? y.toLocaleString() : y}</td><td className="d">{d === null ? "" : d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString()}`}</td></tr>); })}</tbody>
      </table>
    </div>
  );
}

/** The seat's decisions by day: each arm's sittings that day, side by side. */
function Decisions({ A, B, onOpen }: { A: Arm; B: Arm; onOpen: (run: string) => void }) {
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT), setRun = useLens((s) => s.setRun);
  const days = useMemo(() => {
    const m = new Map<number, { a: number[]; b: number[] }>();
    const add = (x: Arm, side: "a" | "b") => x.seat.sittings.forEach((s) => { if (s.t < x.seat.fork_at) return; const d = Math.floor(s.t / DAY); const e = m.get(d) ?? { a: [], b: [] }; e[side].push(s.i); m.set(d, e); });
    add(A, "a"); add(B, "b");
    return [...m.entries()].sort((x, y) => x[0] - y[0]);
  }, [A, B]);
  const cell = (x: Arm, ids: number[]) => ids.map((i) => {
    const s = x.seat.sittings[i]!;
    const strong = [...new Set(s.levers.map((l) => x.seat.levers[l]!).filter((l) => l.level !== "considered").map((l) => l.title))];
    return (
      <button key={i} className={`cp-sit ${s.kind}`} onClick={() => { onOpen(x.key); setRun(x.key); select({ kind: "sitting", index: i }); setT(s.t); }}>
        <span className="g">{s.gist || "—"}</span>
        {strong.map((t) => <span key={t} className="st-chip flag">⚑ {t}</span>)}
        {s.refused > 0 && <span className="st-chip bad">{s.refused} refused</span>}
      </button>
    );
  });
  return (
    <div className="cp-dec">
      <div className="cp-sec-head"><h3>Decisions, day by day</h3><span className="st-faint">the seat's sittings; a code seat's acts gathered by day</span></div>
      <div className="cp-dec-grid cp-dec-headrow"><span /><span className="a">{armName(A.seat)}</span><span className="b">{armName(B.seat)}</span></div>
      <div className="cp-dec-list">
        {days.map(([d, e]) => (
          <div key={d} className="cp-dec-grid">
            <span className="day">Day {worldDay(d * DAY)}</span>
            <div className="col">{e.a.length ? cell(A, e.a) : <span className="none">·</span>}</div>
            <div className="col">{e.b.length ? cell(B, e.b) : <span className="none">·</span>}</div>
          </div>
        ))}
        {!days.length && <div className="st-empty">Neither seat did anything after the fork.</div>}
      </div>
    </div>
  );
}

/** The panels worth drawing: the seat's and the town's headline counts, then the record kinds and refusal codes where
 * the arms differ most after the fork (the rest are alike by construction before it). */
function panels(A: Arm, B: Arm): Panel[] {
  const fork = Math.floor(Math.min(A.seat.fork_at, B.seat.fork_at) / DAY);
  const head: [string, string][] = [["seat_acts", "The seat's acts"], ["seat_refused", "The seat's acts refused"], ["acts", "All acts"], ["refused", "All acts refused"], ["transfers", "Payments"], ["transfer_cents", "Money paid (cents)"], ["town_net", "The town's account, net (cents)"], ["records", "Records filed"], ["left", "People who left"], ["ill", "Illnesses begun"], ["died", "Deaths"]];
  const out: Panel[] = head.map(([k, title]) => ({ id: k, title, note: A.daily.legend[k] ?? "", a: A.daily.series[k] ?? [], b: B.daily.series[k] ?? [], money: k.includes("cents") }));
  const diff = (a: number[] = [], b: number[] = []) => { let s = 0, ta = 0, tb = 0; for (let i = fork; i < Math.max(a.length, b.length); i++) { ta += a[i] ?? 0; tb += b[i] ?? 0; s = Math.abs(ta - tb); } return s; };
  const kinds = [...new Set([...Object.keys(A.daily.records), ...Object.keys(B.daily.records)])].map((k) => ({ k, d: diff(A.daily.records[k], B.daily.records[k]) })).filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 15);
  for (const { k } of kinds) out.push({ id: `rec:${k}`, title: human(k), note: `Records of kind ${k}`, a: A.daily.records[k] ?? [], b: B.daily.records[k] ?? [], group: "Records filed, by kind (where the arms differ most)" });
  const codes = [...new Set([...Object.keys(A.daily.refused), ...Object.keys(B.daily.refused)])].map((k) => ({ k, d: diff(A.daily.refused[k], B.daily.refused[k]) })).filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 6);
  for (const { k } of codes) out.push({ id: `ref:${k}`, title: k, note: `Acts refused with code ${k}`, a: A.daily.refused[k] ?? [], b: B.daily.refused[k] ?? [], group: "Refusals, by code (where the arms differ most)" });
  return out;
}
