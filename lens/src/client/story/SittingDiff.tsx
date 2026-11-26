// The same moment, different models (#/diff/<keyA>,<keyB>[,<keyC>]?day=<n>): forks of one seed, side by side at the
// comparable sitting. Before the fork the towns are the same; after it each seat sits on its own days, so "comparable"
// is the sitting nearest the chosen day in each run (the first on or after it, else the last before), each labelled with
// its own day. Every column shows what that seat thought and said in that sitting, and what it did, by the same views
// as the sitting reader; one search marks all columns. Nothing here ranks the columns.
import { useEffect, useMemo, useState } from "react";
import { loadSeat, loadSitting, useAsync, when, usd, plural, type SeatJson } from "./data";
import { Said, Happened, type Detail } from "./SittingReader";
import { MarksContext, type Marks } from "./text";
import { seatOutcome } from "./data";
import { PageAnswer } from "../shell/Shell";
import { goalText, modelName } from "../words";
import "./story.css";
import "./diff.css";
import { dayNo, dayOf } from "../format";

const DAY = 86_400;
const modelOf = (s: SeatJson) => (s.model ? modelName(s.model) : "the rule-based mayor");

/** The sitting of a run nearest a day: the first on or after it, else the last before. */
export function nearestSitting(seat: SeatJson, day: number): number | null {
  const ss = seat.sittings.filter((s) => s.kind === "model" || seat.sittings.every((x) => x.kind === "code"));
  if (!ss.length) return null;
  const after = ss.find((s) => s.day >= day);
  return (after ?? ss[ss.length - 1]!).i;
}

export function SittingDiff({ keys, day }: { keys: string[]; day?: number }) {
  const seats = useAsync(() => Promise.all(keys.map((k) => loadSeat(k))), [keys.join(",")]);
  if (seats === undefined) return <div className="df"><div className="st-empty">Reading {keys.length} runs…</div></div>;
  if (seats instanceof Error) return <div className="df"><div className="st-empty">Could not read the runs: {seats.message}</div></div>;
  return <Diff keys={keys} seats={seats} initial={day} />;
}

function Diff({ keys, seats, initial }: { keys: string[]; seats: SeatJson[]; initial?: number }) {
  const days = useMemo(() => [...new Set(seats.flatMap((s) => s.sittings.filter((x) => x.kind === "model").map((x) => x.day)))].sort((a, b) => a - b), [seats]);
  const [day, setDay] = useState(initial ?? days[0] ?? Math.floor(seats[0]!.fork_at / DAY));
  const [query, setQuery] = useState("");
  useEffect(() => { const h = location.hash; if (h.startsWith("#/diff/")) { const base = h.split("?")[0]; history.replaceState(null, "", `${base}?day=${day}`); } }, [day]);
  const seeds = new Set(seats.map((s) => s.seed));
  const marks: Marks = useMemo(() => ({ query, levers: [] }), [query]);
  const at = days.indexOf(day);
  // (The poll as first called: a seat that moved it would otherwise set the count for all.)
  const polls = seats.map((s) => s.election.poll_at).filter((x): x is number => x !== undefined), poll = polls.length ? Math.min(...polls) : undefined;
  return (
    <div className="df">
      <div className="df-head">
        <div>
          <PageAnswer page="diff" />
          <h1 className="df-title">Day {day}, {seats.length} AI mayors side by side</h1>
          <p className="st-sub">{seeds.size === 1 ? `The same town (seed ${[...seeds][0]}) in every column.` : "These runs are not the same town."}{poll !== undefined ? ` Election day was due on day ${dayOf(poll)}, ${Math.floor(poll / DAY) - day} days later.` : ""}</p>
        </div>
        <span style={{ flex: 1 }} />
        <div className="st-search"><span className="st-faint">⌕</span><input placeholder="Mark in every column" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <button className="st-btn" disabled={at <= 0} onClick={() => setDay(days[at - 1]!)}>Earlier day</button>
        <select className="df-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>{days.map((d) => <option key={d} value={d}>day {dayNo(d)}</option>)}</select>
        <button className="st-btn" disabled={at < 0 || at >= days.length - 1} onClick={() => setDay(days[at + 1]!)}>Later day</button>
      </div>
      <div className="df-days">{days.map((d) => {
        const who = seats.filter((s) => s.sittings.some((x) => x.day === d && x.kind === "model")).length;
        const lev = seats.some((s) => s.sittings.some((x) => x.day === d && x.lever_level && x.lever_level !== "considered"));
        return <button key={d} className={`df-tick ${d === day ? "on" : ""} ${lev ? "lev" : ""}`} style={{ opacity: 0.35 + (0.65 * who) / seats.length }} title={`day ${dayNo(d)}: ${who} of ${seats.length} seats sat${lev ? "; a lever" : ""}`} onClick={() => setDay(d)} />;
      })}</div>
      <MarksContext.Provider value={marks}>
        <div className="df-cols" style={{ gridTemplateColumns: `repeat(${seats.length}, minmax(320px, 1fr))` }}>
          {seats.map((s, k) => <Column key={keys[k]} runKey={keys[k]!} seat={s} day={day} />)}
        </div>
      </MarksContext.Provider>
    </div>
  );
}

function Column({ runKey, seat, day }: { runKey: string; seat: SeatJson; day: number }) {
  const i = nearestSitting(seat, day);
  const s = i !== null ? seat.sittings[i]! : undefined;
  const d = useAsync(() => (i === null ? null : (loadSitting(runKey, i) as Promise<Detail>)), [runKey, i]);
  const levers = s ? s.levers.map((x) => seat.levers[x]!) : [];
  const off = s ? s.day - day : 0;
  return (
    <div className="df-col">
      <div className="df-col-head">
        <div className="df-model">{modelOf(seat)}</div>
        <p className="st-faint" style={{ fontSize: 11.5, margin: 0 }}>{seat.goal ? `${goalText(seat.goal)}. ` : ""}{seatOutcome(seat).label}. Cost {usd(seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0))}.</p>
        {s ? <p className="df-when">Turn {s.i + 1}, {when(s.t)}{off !== 0 ? <span className="df-off"> (it took no turn on day {day}; this is {off > 0 ? `${off} days later` : `${-off} days earlier`})</span> : null}. {s.acts.length ? `${plural(s.acts.length, "act")}.` : "No acts."}</p> : <p className="df-when">No turns.</p>}
        {s && <div className="df-gist">{s.gist}</div>}
        {s && <a className="st-btn" href={`#/run/${encodeURIComponent(runKey)}?t=${Math.round(s.t)}&sel=sitting:${s.i}`}>Open this turn in its run</a>}
      </div>
      <div className="df-col-body">
        {d === undefined ? <div className="st-faint">…</div> : d === null || d instanceof Error ? <div className="st-faint">—</div> : (
          <>
            <Said seat={seat} d={d} levers={levers} />
            {(d.acts.length > 0 || d.drafts.length > 0 || d.failures.length > 0) && <><div className="df-sep">What happened</div><Happened seat={seat} d={d} levers={levers} /></>}
          </>
        )}
      </div>
    </div>
  );
}
